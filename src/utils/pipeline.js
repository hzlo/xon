// 容器构建流水线模块:
// - 内置无外部依赖的 PowerShell 构建脚本(替代原 deloy/package.ps1)
// - 级联解析 Project 级与 Command 级构建参数
// - 解析原 deloy package.config.json 实现一键导入迁移

/** 校验是否为 Windows 绝对路径(盘符或 UNC 路径) */
export function isAbsoluteWinPath(p) {
  const s = (p || "").trim();
  return /^[a-zA-Z]:[\\/]/.test(s) || /^\\\\/.test(s);
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

/** 级联解析流水线最终生效参数: Command 覆盖 > Project 默认 */
export function resolvePipelineParams(project, command) {
  const pipe = command?.pipeline ?? {};
  const projDir = (project?.dir || "").trim();
  const rawRepo = (pipe.repoDir || "").trim();

  let repoDir = projDir;
  if (rawRepo) {
    repoDir = isAbsoluteWinPath(rawRepo) ? rawRepo : joinWinPath(projDir, rawRepo);
  }

  const saveDir = (pipe.saveDir || "").trim() || (project?.saveDir || "").trim();
  const wslDistro = (pipe.wslDistro || "").trim() || (project?.wslDistro || "").trim();
  const imageName = (pipe.imageName || "").trim();
  const imageTag = (pipe.imageTag || "").trim() || "latest";
  const dockerfilePath = (pipe.dockerfilePath || "").trim();
  const buildContext = (pipe.buildContext || "").trim() || ".";
  const gitPull = pipe.gitPull !== false;
  const exportTar = pipe.exportTar !== false;

  return {
    repoDir,
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
 * 严格保留原 package.ps1 经验证的 WSL 路径转换与 /tmp 中转导出机制(防止 9p 内存溢出)。
 */
export const PIPELINE_PS1 = `
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
if ([System.Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT) {
    chcp 65001 | Out-Null
}

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

function ConvertTo-BashSingleQuoted([string]$Value) {
    $q = "'" + '"' + "'" + '"' + "'"
    return "'" + ($Value -replace "'", $q) + "'"
}

function Format-FileSize([long]$Bytes) {
    if ($Bytes -ge 1GB) { return "{0:N2} GB" -f ($Bytes / 1GB) }
    if ($Bytes -ge 1MB) { return "{0:N2} MB" -f ($Bytes / 1MB) }
    if ($Bytes -ge 1KB) { return "{0:N2} KB" -f ($Bytes / 1KB) }
    return "$Bytes B"
}

$RepoDir        = [string]$env:XON_PIPE_REPO_DIR
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

$WslArgs = if ([string]::IsNullOrWhiteSpace($WslDistro)) { @() } else { @("-d", $WslDistro) }

function ConvertTo-WslPath([string]$WindowsPath) {
    $converted = & wsl @WslArgs -e wslpath -a -u $WindowsPath
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($converted)) {
        throw "WSL 路径转换失败: $WindowsPath"
    }
    return ($converted | Select-Object -First 1).Trim()
}

function Invoke-WslBash([string]$Cmd, [string]$ErrMsg) {
    & wsl @WslArgs -e bash -lc $Cmd
    if ($LASTEXITCODE -ne 0) {
        throw $ErrMsg
    }
}

try {
    if ([string]::IsNullOrWhiteSpace($RepoDir)) { throw "未配置代码仓库目录 (repoDir)" }
    if ([string]::IsNullOrWhiteSpace($ImageName)) { throw "未配置镜像名称 (imageName)" }
    if ([string]::IsNullOrWhiteSpace($DockerfilePath)) { throw "未配置 Dockerfile 路径" }

    $RepoDir = [System.IO.Path]::GetFullPath($RepoDir)
    if (-not (Test-Path -LiteralPath $RepoDir -PathType Container)) {
        throw "代码仓库目录不存在: $RepoDir"
    }

    Set-Location -LiteralPath $RepoDir

    $FullImageTag = if ($ImageName -match ':') { $ImageName } else { "\${ImageName}:\${ImageTag}" }
    $BaseImageName = ($FullImageTag -split ':')[0]

    $BuildContextFull = if ([System.IO.Path]::IsPathRooted($BuildContext)) {
        $BuildContext
    } else {
        Join-Path $RepoDir $BuildContext
    }
    if (-not (Test-Path -LiteralPath $BuildContextFull -PathType Container)) {
        throw "Build context 不存在: $BuildContextFull"
    }

    Write-Info "仓库目录: $RepoDir"
    Write-Info "目标镜像: $FullImageTag"

    if ($EnableGitPull) {
        Write-Step "Step 1: Git Pull"
        Write-Info "正在拉取最新代码..."
        & git pull
        if ($LASTEXITCODE -ne 0) {
            throw "Git pull 失败，请检查网络与分支状态"
        }
        Write-Ok "Git pull 成功"
    }

    if (Test-Path -LiteralPath (Join-Path $RepoDir ".git")) {
        $CommitHash = (& git rev-parse --short HEAD 2>$null)
        if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($CommitHash)) {
            $CommitMsg = ((& git log -1 --pretty=%B 2>$null) -join " ").Trim()
            Write-Info ("当前 Commit: " + $CommitHash.Trim() + ($(if ($CommitMsg) { " - $CommitMsg" } else { "" })))
        }
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

    if ($EnableExport) {
        if ([string]::IsNullOrWhiteSpace($SaveDir)) {
            throw "已勾选导出 .tar，但未配置产物输出目录 (saveDir)"
        }
        $SaveDir = [System.IO.Path]::GetFullPath($SaveDir)
        New-Item -ItemType Directory -Force -Path $SaveDir | Out-Null

        Write-Step "Step 3: Docker Save"
        $DateSuffix = Get-Date -Format "yyyyMMdd"
        $SafeBaseName = ($BaseImageName -replace '[\\\\/:*?"<>|]', '_')
        $TarFileName = "$SafeBaseName$DateSuffix.tar"
        $SaveFile = Join-Path $SaveDir $TarFileName
        $WslSaveDir = ConvertTo-WslPath $SaveDir
        $WslSaveFile = ConvertTo-WslPath $SaveFile
        # 先写入 WSL 内部 /tmp 再拷贝到 Windows 挂载盘: 规避 9p 文件系统缓冲报错
        $WslTempSaveFile = "/tmp/$TarFileName"

        Write-Info "正在保存镜像到: $SaveFile"
        $SaveBash = @(
            "cd $(ConvertTo-BashSingleQuoted $WslRepoDir)",
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
    cwd: p.repoDir || "",
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
    ? (isAbsoluteWinPath(rawSaveDir)
        ? rawSaveDir.replace(/\//g, "\\")
        : joinWinPath(baseDir, rawSaveDir))
    : "";
  const wslDistro = (defaults.wslDistro || "").trim();

  const commands = [];
  for (const [key, item] of Object.entries(data.projects)) {
    if (!item || typeof item !== "object") continue;
    const rawRepo = (item.repoDir || "").trim();
    const repoDir = rawRepo
      ? (isAbsoluteWinPath(rawRepo)
          ? rawRepo.replace(/\//g, "\\")
          : joinWinPath(baseDir, rawRepo))
      : baseDir;

    const pipeline = {
      repoDir,
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
      cwd: repoDir,
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
