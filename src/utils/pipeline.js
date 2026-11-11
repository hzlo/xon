// 容器构建流水线模块:
// - 内置无外部依赖的 PowerShell 构建脚本(支持 Windows 仓库与 WSL 原生仓库双模式)
// - 支持配置 Git 仓库地址与分支,目录不存在时自动 git clone
// - 级联解析 Project 级与 Command 级构建参数
// - 解析原 deloy package.config.json 实现一键导入迁移

/** 校验是否为 Windows 绝对路径(盘符或 UNC 路径) */
export function isAbsoluteWinPath(p) {
  const s = (p || "").trim();
  return /^[a-zA-Z]:[\\/]/.test(s) || /^\\\\/.test(s);
}

/** 校验是否为 WSL/Linux 原生路径(以 / 或 ~ 开头) */
export function isWslPath(p) {
  const s = (p || "").trim();
  return s.startsWith("/") || s.startsWith("~");
}

/** 轻量拼接 Windows 路径,处理 ./ 前缀与斜杠归一化 */
export function joinWinPath(baseDir, relPath) {
  const base = (baseDir || "").trim().replace(/[\\/]+$/, "");
  const raw = (relPath || "").trim();
  if (!raw || raw === ".") return base;
  if (isAbsoluteWinPath(raw)) return raw;
  const cleaned = raw.replace(/^\.[\\/]+/, "").replace(/\//g, "\\");
  if (!base) return cleaned;
  return `${base}\\${cleaned}`;
}

/** 轻量拼接 WSL POSIX 路径 */
export function joinWslPath(baseDir, relPath) {
  const base = (baseDir || "").trim().replace(/\/+$/, "");
  const raw = (relPath || "").trim();
  if (!raw || raw === ".") return base;
  if (isWslPath(raw)) return raw;
  const cleaned = raw.replace(/^\.[\\/]+/, "").replace(/\\/g, "/");
  if (!base) return cleaned;
  return `${base}/${cleaned}`;
}

/** 级联解析流水线最终生效参数: Command 覆盖 > Project 默认 */
export function resolvePipelineParams(project, command) {
  const pipe = command?.pipeline ?? {};
  const projDir = (project?.dir || "").trim();
  const rawRepo = (pipe.repoDir || "").trim();

  let repoDir = projDir;
  if (rawRepo) {
    if (isWslPath(rawRepo) || isAbsoluteWinPath(rawRepo)) {
      repoDir = rawRepo;
    } else if (isWslPath(projDir)) {
      repoDir = joinWslPath(projDir, rawRepo);
    } else {
      repoDir = joinWinPath(projDir, rawRepo);
    }
  }

  const saveDir = (pipe.saveDir || "").trim() || (project?.saveDir || "").trim();
  const wslDistro = (pipe.wslDistro || "").trim() || (project?.wslDistro || "").trim();
  const gitUrl = (pipe.gitUrl || "").trim();
  const gitBranch = (pipe.gitBranch || "").trim();
  const imageName = (pipe.imageName || "").trim();
  const imageTag = (pipe.imageTag || "").trim() || "latest";
  const dockerfilePath = (pipe.dockerfilePath || "").trim();
  const buildContext = (pipe.buildContext || "").trim() || ".";
  const gitPull = pipe.gitPull !== false;
  const exportTar = pipe.exportTar !== false;

  return {
    repoDir,
    gitUrl,
    gitBranch,
    saveDir,
    wslDistro,
    imageName,
    imageTag,
    dockerfilePath,
    buildContext,
    gitPull,
    exportTar,
  };
}

/** 生成用于左侧列表与摘要展示的短文本 */
export function formatPipelineSummary(pipeline) {
  if (!pipeline) return "docker build";
  const img = (pipeline.imageName || "").trim();
  const tag = (pipeline.imageTag || "").trim() || "latest";
  if (!img) return "docker build";
  return img.includes(":") ? `docker: ${img}` : `docker: ${img}:${tag}`;
}

/**
 * 自包含容器构建 PowerShell 脚本(纯 UTF-8 逻辑,通过环境变量 XON_PIPE_* 接收参数)。
 * - 支持自动 git clone(当仓库目录不存在且配置了 gitUrl)与指定分支切换/拉取
 * - 当 repoDir 为 / 或 ~ 开头时: 全流程在 WSL 原生 ext4 内完成
 * - 当 repoDir 为 Windows 路径时: 保留在宿主机拉取并自动映射进 WSL 构建
 * - 导出 .tar 到 Windows 目录时保留 /tmp 中转拷贝机制(规避 9p 内存溢出)
 */
export const PIPELINE_PS1 = `
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
if ([System.Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT) {
    chcp 65001 | Out-Null
}
$env:WSL_UTF8 = "1"

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ESC = [char]27
function Write-Info([string]$Msg)  { Write-Host "$ESC[34m[INFO]$ESC[0m $Msg" }
function Write-Ok([string]$Msg)    { Write-Host "$ESC[32m[OK]$ESC[0m $Msg" }
function Write-Warn([string]$Msg)  { Write-Host "$ESC[33m[WARN]$ESC[0m $Msg" }
function Write-Err([string]$Msg)   { Write-Host "$ESC[31m[ERROR]$ESC[0m $Msg" }
function Write-Step([string]$Title) {
    Write-Host ""
    Write-Host "$ESC[36m========================================$ESC[0m"
    Write-Host "$ESC[36m  $Title$ESC[0m"
    Write-Host "$ESC[36m========================================$ESC[0m"
}

function Test-IsWslPath([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) { return $false }
    $t = $Value.Trim()
    return $t.StartsWith("/") -or $t.StartsWith("~")
}

function ConvertTo-BashSingleQuoted([string]$Value) {
    $q = "'" + '"' + "'" + '"' + "'"
    return "'" + ($Value -replace "'", $q) + "'"
}

function ConvertTo-BashPathExpr([string]$PathValue) {
    $t = $PathValue.Trim()
    if ($t -eq "~") {
        return '"$HOME"'
    }
    if ($t.StartsWith("~/")) {
        $rest = $t.Substring(2)
        return '"$HOME/"' + (ConvertTo-BashSingleQuoted $rest)
    }
    return (ConvertTo-BashSingleQuoted $t)
}

function Format-FileSize([long]$Bytes) {
    if ($Bytes -ge 1GB) { return "{0:N2} GB" -f ($Bytes / 1GB) }
    if ($Bytes -ge 1MB) { return "{0:N2} MB" -f ($Bytes / 1MB) }
    if ($Bytes -ge 1KB) { return "{0:N2} KB" -f ($Bytes / 1KB) }
    return "$Bytes B"
}

$RepoDir        = [string]$env:XON_PIPE_REPO_DIR
$GitUrl         = [string]$env:XON_PIPE_GIT_URL
$GitBranch      = [string]$env:XON_PIPE_GIT_BRANCH
$ImageName      = [string]$env:XON_PIPE_IMAGE_NAME
$ImageTag       = [string]$env:XON_PIPE_IMAGE_TAG
$DockerfilePath = [string]$env:XON_PIPE_DOCKERFILE
$BuildContext   = [string]$env:XON_PIPE_CONTEXT
$EnableGitPull  = ($env:XON_PIPE_GIT_PULL -eq "1")
$EnableExport   = ($env:XON_PIPE_EXPORT_TAR -eq "1")
$SaveDir        = [string]$env:XON_PIPE_SAVE_DIR
$WslDistro      = [string]$env:XON_PIPE_WSL_DISTRO

if ([string]::IsNullOrWhiteSpace($ImageTag)) { $ImageTag = "latest" }
if ([string]::IsNullOrWhiteSpace($BuildContext)) { $BuildContext = "." }
$GitUrl = $GitUrl.Trim()
$GitBranch = $GitBranch.Trim()

$WslArgs = if ([string]::IsNullOrWhiteSpace($WslDistro)) { @() } else { @("-d", $WslDistro) }

function ConvertTo-WslPath([string]$WindowsPath) {
    $converted = & wsl @WslArgs -e wslpath -a -u $WindowsPath
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($converted)) {
        throw "WSL 路径转换失败: $WindowsPath"
    }
    return ($converted | Select-Object -First 1).Trim()
}

function Get-WslLauncher([string]$Cmd) {
    $b64 = [System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($Cmd))
    return ('source <(echo ' + $b64 + ' | base64 -d)')
}

function Invoke-WslBash([string]$Cmd, [string]$ErrMsg) {
    & wsl @WslArgs -e bash -l -c (Get-WslLauncher $Cmd)
    if ($LASTEXITCODE -ne 0) {
        throw $ErrMsg
    }
}

function Test-WslBash([string]$Cmd) {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & wsl @WslArgs -e bash -l -c (Get-WslLauncher $Cmd) | Out-Null
        return ($LASTEXITCODE -eq 0)
    }
    finally {
        $ErrorActionPreference = $prev
    }
}

function Invoke-WslQuiet([string]$Cmd) {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        return (& wsl @WslArgs -e bash -l -c (Get-WslLauncher $Cmd) 2>$null)
    }
    finally {
        $ErrorActionPreference = $prev
    }
}

try {
    if ([string]::IsNullOrWhiteSpace($RepoDir)) { throw "未配置代码仓库目录 (repoDir)" }
    if ([string]::IsNullOrWhiteSpace($ImageName)) { throw "未配置镜像名称 (imageName)" }
    if ([string]::IsNullOrWhiteSpace($DockerfilePath)) { throw "未配置 Dockerfile 路径" }

    $RepoDir = $RepoDir.Trim()
    $IsWslRepo = Test-IsWslPath $RepoDir
    $FullImageTag = if ($ImageName -match ':') { $ImageName } else { "\${ImageName}:\${ImageTag}" }
    $BaseImageName = ($FullImageTag -split ':')[0]

    if ($IsWslRepo) {
        $RepoDirNorm = if ($RepoDir -eq "/") { "/" } else { $RepoDir.TrimEnd('/') }
        $WslRepoExpr = ConvertTo-BashPathExpr $RepoDirNorm
        $GitCheckExpr = if ($RepoDirNorm -eq "/") { "/.git" } else { "$RepoDirNorm/.git" }
        $WslGitExpr = ConvertTo-BashPathExpr $GitCheckExpr

        Write-Info "仓库目录 (WSL): $RepoDirNorm"
        Write-Info "目标镜像: $FullImageTag"

        $HasGitRepo = Test-WslBash ('test -d ' + $WslGitExpr)

        if (-not $HasGitRepo) {
            if (-not [string]::IsNullOrWhiteSpace($GitUrl)) {
                $NonEmptyCmd = 'test -e ' + $WslRepoExpr + ' && [ -n "$(ls -A ' + $WslRepoExpr + ' 2>/dev/null)" ]'
                if (Test-WslBash $NonEmptyCmd) {
                    throw "WSL 目录已存在且非空(非 Git 仓库)，无法自动 clone: $RepoDirNorm"
                }
                Write-Step "Step 1: Git Clone (WSL)"
                Write-Info "正在克隆仓库: $GitUrl"
                $BranchArg = if (-not [string]::IsNullOrWhiteSpace($GitBranch)) { "-b $(ConvertTo-BashSingleQuoted $GitBranch) " } else { "" }
                $CloneBash = 'mkdir -p "$(dirname ' + $WslRepoExpr + ')" && git clone ' + $BranchArg + (ConvertTo-BashSingleQuoted $GitUrl) + ' ' + $WslRepoExpr
                Invoke-WslBash $CloneBash "Git clone 失败，请检查仓库地址、分支与认证凭据"
                Write-Ok "Git clone 成功"
            }
            else {
                Invoke-WslBash ('test -d ' + $WslRepoExpr) "WSL 中代码仓库目录不存在: $RepoDirNorm（可填写 Git 仓库地址以自动 clone）"
            }
        }
        elseif ((-not [string]::IsNullOrWhiteSpace($GitBranch)) -or $EnableGitPull) {
            Write-Step "Step 1: Git Sync (WSL)"
            if (-not [string]::IsNullOrWhiteSpace($GitBranch)) {
                $CurrBranchRaw = Invoke-WslQuiet ('cd ' + $WslRepoExpr + ' && git rev-parse --abbrev-ref HEAD')
                $CurrBranch = (($CurrBranchRaw -join "")).Trim()
                if ($CurrBranch -ne $GitBranch) {
                    Write-Info "切换分支: $CurrBranch -> $GitBranch"
                    $QBranch = ConvertTo-BashSingleQuoted $GitBranch
                    $SwitchBash = "cd $WslRepoExpr && git fetch origin $QBranch && (git checkout $QBranch || git checkout -b $QBranch origin/$QBranch)"
                    Invoke-WslBash $SwitchBash "切换分支失败: $GitBranch"
                }
            }
            if ($EnableGitPull) {
                Write-Info "正在 WSL 内拉取最新代码..."
                $PullBash = if (-not [string]::IsNullOrWhiteSpace($GitBranch)) {
                    "cd $WslRepoExpr && git pull origin $(ConvertTo-BashSingleQuoted $GitBranch)"
                } else {
                    "cd $WslRepoExpr && git pull"
                }
                Invoke-WslBash $PullBash "Git pull 失败，请检查 WSL 内网络与分支状态"
                Write-Ok "Git pull 成功"
            }
        }

        $CommitLine = Invoke-WslQuiet ('cd ' + $WslRepoExpr + ' && if [ -d .git ]; then git log -1 --format="%h - %s"; fi')
        if (-not [string]::IsNullOrWhiteSpace(($CommitLine -join ""))) {
            Write-Info ("当前 Commit: " + (($CommitLine -join " ").Trim()))
        }

        $DockerNorm = $DockerfilePath.Trim() -replace '\\\\', '/'
        $ContextNorm = $BuildContext.Trim() -replace '\\\\', '/'
        $WslDockerArg = if ($DockerNorm -match '^[a-zA-Z]:/') {
            ConvertTo-BashSingleQuoted (ConvertTo-WslPath $DockerfilePath.Trim())
        } else {
            ConvertTo-BashPathExpr $DockerNorm
        }
        $WslContextArg = if ($ContextNorm -match '^[a-zA-Z]:/') {
            ConvertTo-BashSingleQuoted (ConvertTo-WslPath $BuildContext.Trim())
        } else {
            ConvertTo-BashPathExpr $ContextNorm
        }

        Invoke-WslBash "cd $WslRepoExpr && test -d $WslContextArg" "Build context 在 WSL 中不存在: $BuildContext"
        Invoke-WslBash "cd $WslRepoExpr && test -f $WslDockerArg" "Dockerfile 在 WSL 中不存在: $DockerfilePath"

        Write-Step "Step 2: Docker Build (WSL)"
        Write-Info "执行构建: docker build -t $FullImageTag -f $DockerNorm $ContextNorm"
        $BuildBash = "cd $WslRepoExpr && docker build -t $(ConvertTo-BashSingleQuoted $FullImageTag) -f $WslDockerArg $WslContextArg"
        Invoke-WslBash $BuildBash "Docker build 失败"
        Write-Ok "Docker build 成功: $FullImageTag"
    }
    else {
        $RepoDir = [System.IO.Path]::GetFullPath($RepoDir)
        $HasGitRepo = Test-Path -LiteralPath (Join-Path $RepoDir ".git") -PathType Container

        Write-Info "仓库目录 (Windows): $RepoDir"
        Write-Info "目标镜像: $FullImageTag"

        if (-not $HasGitRepo) {
            if (-not [string]::IsNullOrWhiteSpace($GitUrl)) {
                if ((Test-Path -LiteralPath $RepoDir) -and (@(Get-ChildItem -LiteralPath $RepoDir -Force).Count -gt 0)) {
                    throw "目录已存在且非空(非 Git 仓库)，无法自动 clone: $RepoDir"
                }
                $ParentDir = Split-Path -Parent $RepoDir
                if (-not [string]::IsNullOrWhiteSpace($ParentDir)) {
                    New-Item -ItemType Directory -Force -Path $ParentDir | Out-Null
                }
                Write-Step "Step 1: Git Clone"
                Write-Info "正在克隆仓库: $GitUrl"
                if (-not [string]::IsNullOrWhiteSpace($GitBranch)) {
                    & git clone -b $GitBranch $GitUrl $RepoDir
                } else {
                    & git clone $GitUrl $RepoDir
                }
                if ($LASTEXITCODE -ne 0) {
                    throw "Git clone 失败，请检查仓库地址、分支与认证凭据"
                }
                Write-Ok "Git clone 成功"
                $HasGitRepo = $true
            }
            elseif (-not (Test-Path -LiteralPath $RepoDir -PathType Container)) {
                throw "代码仓库目录不存在: $RepoDir（可填写 Git 仓库地址以自动 clone）"
            }
        }

        Set-Location -LiteralPath $RepoDir

        if ($HasGitRepo -and ((-not [string]::IsNullOrWhiteSpace($GitBranch)) -or $EnableGitPull)) {
            Write-Step "Step 1: Git Sync"
            if (-not [string]::IsNullOrWhiteSpace($GitBranch)) {
                $prev = $ErrorActionPreference
                $ErrorActionPreference = "Continue"
                $CurrBranch = ((& git rev-parse --abbrev-ref HEAD 2>$null) -join "").Trim()
                $ErrorActionPreference = $prev
                if ($CurrBranch -ne $GitBranch) {
                    Write-Info "切换分支: $CurrBranch -> $GitBranch"
                    & git fetch origin $GitBranch
                    if ($LASTEXITCODE -ne 0) { throw "拉取分支失败: $GitBranch" }
                    & git checkout $GitBranch
                    if ($LASTEXITCODE -ne 0) {
                        & git checkout -b $GitBranch "origin/$GitBranch"
                        if ($LASTEXITCODE -ne 0) { throw "切换分支失败: $GitBranch" }
                    }
                }
            }
            if ($EnableGitPull) {
                Write-Info "正在拉取最新代码..."
                if (-not [string]::IsNullOrWhiteSpace($GitBranch)) {
                    & git pull origin $GitBranch
                } else {
                    & git pull
                }
                if ($LASTEXITCODE -ne 0) {
                    throw "Git pull 失败，请检查网络与分支状态"
                }
                Write-Ok "Git pull 成功"
            }
        }

        if ($HasGitRepo) {
            $prev = $ErrorActionPreference
            $ErrorActionPreference = "Continue"
            $CommitHash = ((& git rev-parse --short HEAD 2>$null) -join "").Trim()
            if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($CommitHash)) {
                $CommitMsg = ((& git log -1 --pretty=%B 2>$null) -join " ").Trim()
                Write-Info ("当前 Commit: $CommitHash" + ($(if ($CommitMsg) { " - $CommitMsg" } else { "" })))
            }
            $ErrorActionPreference = $prev
        }

        $BuildContextFull = if ([System.IO.Path]::IsPathRooted($BuildContext)) {
            $BuildContext
        } else {
            Join-Path $RepoDir $BuildContext
        }
        if (-not (Test-Path -LiteralPath $BuildContextFull -PathType Container)) {
            throw "Build context 不存在: $BuildContextFull"
        }

        $DockerfileFull = if ([System.IO.Path]::IsPathRooted($DockerfilePath)) {
            $DockerfilePath
        } else {
            Join-Path $RepoDir $DockerfilePath
        }
        if (-not (Test-Path -LiteralPath $DockerfileFull -PathType Leaf)) {
            throw "Dockerfile 不存在: $DockerfileFull"
        }

        Write-Step "Step 2: Docker Build (via WSL)"
        $WslRepoDir = ConvertTo-WslPath $RepoDir
        $WslDockerfile = if ([System.IO.Path]::IsPathRooted($DockerfilePath)) {
            ConvertTo-WslPath $DockerfilePath
        } else {
            ($DockerfilePath -replace '\\\\', '/')
        }
        $WslContext = if ([System.IO.Path]::IsPathRooted($BuildContext)) {
            ConvertTo-WslPath $BuildContext
        } else {
            ($BuildContext -replace '\\\\', '/')
        }

        Write-Info "WSL 路径: $WslRepoDir"
        Write-Info "执行构建: docker build -t $FullImageTag -f $WslDockerfile $WslContext"

        $BuildBash = @(
            "cd $(ConvertTo-BashSingleQuoted $WslRepoDir)",
            "docker build -t $(ConvertTo-BashSingleQuoted $FullImageTag) -f $(ConvertTo-BashSingleQuoted $WslDockerfile) $(ConvertTo-BashSingleQuoted $WslContext)"
        ) -join " && "
        Invoke-WslBash $BuildBash "Docker build 失败"
        Write-Ok "Docker build 成功: $FullImageTag"
    }

    if ($EnableExport) {
        if ([string]::IsNullOrWhiteSpace($SaveDir)) {
            throw "已勾选导出 .tar，但未配置产物输出目录 (saveDir)"
        }

        Write-Step "Step 3: Docker Save"
        $DateSuffix = Get-Date -Format "yyyyMMdd"
        $SafeBaseName = ($BaseImageName -replace '[\\\\/:*?"<>|]', '_')
        $TarFileName = "$SafeBaseName$DateSuffix.tar"

        if (Test-IsWslPath $SaveDir) {
            $SaveDirNorm = $SaveDir.Trim().TrimEnd('/')
            $TargetSaveDir = if ([string]::IsNullOrEmpty($SaveDirNorm)) { "/" } else { $SaveDirNorm }
            $TargetSaveFile = if ($TargetSaveDir -eq "/") { "/$TarFileName" } else { "$TargetSaveDir/$TarFileName" }
            $WslSaveDirExpr = ConvertTo-BashPathExpr $TargetSaveDir
            $WslSaveFileExpr = ConvertTo-BashPathExpr $TargetSaveFile

            Write-Info "正在保存镜像到 (WSL): $TargetSaveFile"
            $SaveBash = "mkdir -p $WslSaveDirExpr && docker save -o $WslSaveFileExpr $(ConvertTo-BashSingleQuoted $FullImageTag)"
            Invoke-WslBash $SaveBash "Docker save 失败"

            $SizeBytesRaw = (Invoke-WslQuiet "stat -c%s $WslSaveFileExpr || wc -c < $WslSaveFileExpr" | Select-Object -First 1)
            $FileSize = if ($SizeBytesRaw -match '^\\d+$') { Format-FileSize ([long]$SizeBytesRaw) } else { "未知大小" }
            Write-Ok "Docker save 成功"
            Write-Ok "镜像产物: $TargetSaveFile ($FileSize)"
        }
        else {
            $SaveDir = [System.IO.Path]::GetFullPath($SaveDir.Trim())
            New-Item -ItemType Directory -Force -Path $SaveDir | Out-Null

            $SaveFile = Join-Path $SaveDir $TarFileName
            $WslSaveDir = ConvertTo-WslPath $SaveDir
            $WslSaveFile = ConvertTo-WslPath $SaveFile
            # 先写入 WSL 内部 /tmp 再拷贝到 Windows 挂载盘: 规避 9p 文件系统缓冲报错
            $WslTempSaveFile = "/tmp/$TarFileName"

            Write-Info "正在保存镜像到: $SaveFile"
            $SaveBash = @(
                "mkdir -p $(ConvertTo-BashSingleQuoted $WslSaveDir)",
                "rm -f $(ConvertTo-BashSingleQuoted $WslTempSaveFile)",
                "docker save -o $(ConvertTo-BashSingleQuoted $WslTempSaveFile) $(ConvertTo-BashSingleQuoted $FullImageTag)",
                "cp $(ConvertTo-BashSingleQuoted $WslTempSaveFile) $(ConvertTo-BashSingleQuoted $WslSaveFile)",
                "rm -f $(ConvertTo-BashSingleQuoted $WslTempSaveFile)"
            ) -join " && "
            Invoke-WslBash $SaveBash "Docker save 失败"

            $SavedItem = Get-Item -LiteralPath $SaveFile
            $FileSize = Format-FileSize $SavedItem.Length
            Write-Ok "Docker save 成功"
            Write-Ok "镜像产物: $SaveFile ($FileSize)"
        }
    }

    Write-Step "Build 完成"
    Write-Ok "镜像: $FullImageTag"
    exit 0
}
catch {
    Write-Err $_.Exception.Message
    exit 1
}
`.trim();

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

let cachedBootstrapCmd = null;
function getBootstrapCommand() {
  if (!cachedBootstrapCmd) {
    const b64 = utf8ToBase64(PIPELINE_PS1);
    cachedBootstrapCmd = `& ([scriptblock]::Create([System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${b64}'))))`;
  }
  return cachedBootstrapCmd;
}

/** 构造用于提交给后端 start_process 的请求参数 */
export function buildPipelineStartPayload(project, command) {
  const p = resolvePipelineParams(project, command);
  const env = {
    ...(command?.env ?? {}),
    XON_PIPE_REPO_DIR: p.repoDir,
    XON_PIPE_GIT_URL: p.gitUrl,
    XON_PIPE_GIT_BRANCH: p.gitBranch,
    XON_PIPE_IMAGE_NAME: p.imageName,
    XON_PIPE_IMAGE_TAG: p.imageTag,
    XON_PIPE_DOCKERFILE: p.dockerfilePath,
    XON_PIPE_CONTEXT: p.buildContext,
    XON_PIPE_GIT_PULL: p.gitPull ? "1" : "0",
    XON_PIPE_EXPORT_TAR: p.exportTar ? "1" : "0",
    XON_PIPE_SAVE_DIR: p.saveDir,
    XON_PIPE_WSL_DISTRO: p.wslDistro,
  };
  if (p.saveDir && !env.XON_SAVE_DIR) {
    env.XON_SAVE_DIR = p.saveDir;
  }
  return {
    cmd: getBootstrapCommand(),
    shell: "powershell",
    // 置空 cwd: 兼容 WSL 原生路径及尚未 clone 的 Windows 目录(由脚本本身在 clone 后切换目录)
    cwd: "",
    env,
  };
}

/**
 * 解析原 deloy 的 package.config.json 内容并转换为 xon 数据结构
 * @param {string} jsonText
 * @param {string} baseDir package.config.json 所在目录(用于解析 ./MES-NET 等相对路径)
 */
export function parseDeloyConfig(jsonText, baseDir = "") {
  const data = JSON.parse(jsonText);
  if (!data || typeof data !== "object" || !data.projects || typeof data.projects !== "object") {
    throw new Error("无效的构建配置文件: 缺少 projects 节点");
  }

  const defaults = data.defaults ?? {};
  const rawSaveDir = (defaults.saveDir || "").trim();
  const saveDir = rawSaveDir
    ? (isWslPath(rawSaveDir)
        ? rawSaveDir
        : isAbsoluteWinPath(rawSaveDir)
          ? rawSaveDir.replace(/\//g, "\\")
          : joinWinPath(baseDir, rawSaveDir))
    : "";
  const wslDistro = (defaults.wslDistro || "").trim();

  const commands = [];
  for (const [key, item] of Object.entries(data.projects)) {
    if (!item || typeof item !== "object") continue;
    const rawRepo = (item.repoDir || "").trim();
    const repoDir = rawRepo
      ? (isWslPath(rawRepo)
          ? rawRepo
          : isAbsoluteWinPath(rawRepo)
            ? rawRepo.replace(/\//g, "\\")
            : joinWinPath(baseDir, rawRepo))
      : baseDir;

    const pipeline = {
      repoDir,
      gitUrl: (item.gitUrl || "").trim(),
      gitBranch: (item.gitBranch || "").trim(),
      imageName: (item.imageName || "").trim(),
      imageTag: "latest",
      dockerfilePath: (item.dockerfilePath || "").trim(),
      buildContext: (item.buildContext || ".").trim() || ".",
      gitPull: true,
      exportTar: true,
      saveDir: "",
      wslDistro: "",
    };

    const displayName = (item.displayName || key).trim();
    commands.push({
      name: `打包 ${displayName}`,
      cmd: formatPipelineSummary(pipeline),
      stopCmd: "",
      shell: "powershell",
      cwd: isWslPath(repoDir) ? "" : repoDir,
      env: {},
      kind: "pipeline",
      pipeline,
    });
  }

  return {
    saveDir,
    wslDistro,
    commands,
  };
}
