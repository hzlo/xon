// 跨平台容器远程构建流水线模块:
// - 统一通过 SSH 驱动远端 Docker 构建(兼容远端 Linux 服务器、云服务器及开启 sshd 的 WSL)
// - 支持配置 Git 反向隧道(ssh -R)，借用本机网络拉取公司内网 Git 仓库
// - 支持远端产物留存与公网/内网下载链接生成
// - 支持构建后自动清理悬空镜像与超限 BuildKit 缓存
// - 级联解析 Project 级与 Command 级构建参数

/** 校验是否为 Windows 绝对路径(盘符或 UNC 路径) */
export function isAbsoluteWinPath(p) {
  const s = (p || "").trim();
  return /^[a-zA-Z]:[\\/]/.test(s) || /^\\\\/.test(s);
}

/** 校验是否为远端 POSIX 路径(以 / 或 ~ 开头) */
export function isPosixPath(p) {
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

/** 轻量拼接 POSIX 路径 */
export function joinPosixPath(baseDir, relPath) {
  const base = (baseDir || "").trim().replace(/\/+$/, "");
  const raw = (relPath || "").trim();
  if (!raw || raw === ".") return base;
  if (isPosixPath(raw)) return raw;
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
    if (isPosixPath(rawRepo) || isAbsoluteWinPath(rawRepo)) {
      repoDir = rawRepo;
    } else if (isPosixPath(projDir)) {
      repoDir = joinPosixPath(projDir, rawRepo);
    } else {
      repoDir = joinWinPath(projDir, rawRepo);
    }
  }

  const remoteSaveDir = (pipe.remoteSaveDir || "").trim() || (project?.remoteSaveDir || "").trim();
  const remotePublicUrl = (pipe.remotePublicUrl || "").trim() || (project?.remotePublicUrl || "").trim();
  const sshHost = (pipe.sshHost || "").trim() || (project?.sshHost || "").trim();
  const gitTunnel = (pipe.gitTunnel || "").trim() || (project?.gitTunnel || "").trim();
  const gitUrl = (pipe.gitUrl || "").trim();
  const gitBranch = (pipe.gitBranch || "").trim();
  const imageName = (pipe.imageName || "").trim();
  const imageTag = (pipe.imageTag || "").trim() || "latest";
  const dockerfilePath = (pipe.dockerfilePath || "").trim();
  const buildContext = (pipe.buildContext || "").trim() || ".";
  const gitPull = pipe.gitPull !== false;
  const exportTar = pipe.exportTar !== false;
  const pruneAfterBuild = pipe.pruneAfterBuild !== false;

  return {
    repoDir,
    gitUrl,
    gitBranch,
    remoteSaveDir,
    remotePublicUrl,
    sshHost,
    gitTunnel,
    imageName,
    imageTag,
    dockerfilePath,
    buildContext,
    gitPull,
    exportTar,
    pruneAfterBuild,
  };
}

/** 生成用于左侧列表与摘要展示的短文本 */
export function formatPipelineSummary(pipeline) {
  if (!pipeline) return "docker build";
  const img = (pipeline.imageName || "").trim();
  const tag = (pipeline.imageTag || "").trim() || "latest";
  if (!img) return "docker build";
  const base = img.includes(":") ? `docker: ${img}` : `docker: ${img}:${tag}`;
  const host = (pipeline.sshHost || "").trim();
  return host ? `${base} @ ${host}` : base;
}

/**
 * 自包含 SSH 远程容器构建 PowerShell 脚本(纯 UTF-8 逻辑,通过环境变量 XON_PIPE_* 接收参数)。
 * - 通过 OpenSSH (ssh.exe -n -T) 驱动远端构建节点,防止继承 XON 的持活 stdin 管道导致退出阻塞
 * - 支持按需启用 ssh -R 反向隧道并自动注入 git url.insteadOf,拉取本机可达的内网 Git
 * - 支持远端目录直接导出 .tar 并输出下载链接
 * - 支持构建后清理悬空镜像与超限 BuildKit 缓存
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

function Test-IsPosixPath([string]$Value) {
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

$RepoDir          = [string]$env:XON_PIPE_REPO_DIR
$GitUrl           = [string]$env:XON_PIPE_GIT_URL
$GitBranch        = [string]$env:XON_PIPE_GIT_BRANCH
$ImageName        = [string]$env:XON_PIPE_IMAGE_NAME
$ImageTag         = [string]$env:XON_PIPE_IMAGE_TAG
$DockerfilePath   = [string]$env:XON_PIPE_DOCKERFILE
$BuildContext     = [string]$env:XON_PIPE_CONTEXT
$EnableGitPull    = ($env:XON_PIPE_GIT_PULL -eq "1")
$EnableExport     = ($env:XON_PIPE_EXPORT_TAR -eq "1")
$RemoteSaveDir    = [string]$env:XON_PIPE_REMOTE_SAVE_DIR
$RemotePublicUrl  = [string]$env:XON_PIPE_REMOTE_PUBLIC_URL
$SshHost          = [string]$env:XON_PIPE_SSH_HOST
$GitTunnel        = [string]$env:XON_PIPE_GIT_TUNNEL
$EnablePrune      = ($env:XON_PIPE_PRUNE -eq "1")

if ([string]::IsNullOrWhiteSpace($ImageTag)) { $ImageTag = "latest" }
if ([string]::IsNullOrWhiteSpace($BuildContext)) { $BuildContext = "." }
$GitUrl = $GitUrl.Trim()
$GitBranch = $GitBranch.Trim()
$SshHost = $SshHost.Trim()
$GitTunnel = $GitTunnel.Trim()
$RemoteSaveDir = $RemoteSaveDir.Trim()
$RemotePublicUrl = $RemotePublicUrl.Trim().TrimEnd('/')

# 必须带 -n -T: XON 保持子进程 stdin 管道打开, 若 ssh.exe 继承打开的 stdin 会偶发阻塞等待通道 EOF
$SshCommonOpts = @(
    "-n", "-T",
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=10",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=3",
    "-o", "StrictHostKeyChecking=accept-new"
)

function Invoke-RemoteBash([string]$Cmd, [string]$ErrMsg, [string[]]$ExtraSshArgs = @()) {
    $normCmd = "set -eo pipefail\`n" + ($Cmd -replace "\`r\`n", "\`n")
    $b64 = [System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($normCmd))
    $remoteCmd = "echo $b64 | base64 -d | bash -l"
    & ssh @SshCommonOpts @ExtraSshArgs $SshHost $remoteCmd
    if ($LASTEXITCODE -ne 0) {
        throw $ErrMsg
    }
}

function Test-RemoteBash([string]$Cmd) {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $normCmd = $Cmd -replace "\`r\`n", "\`n"
        $b64 = [System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($normCmd))
        & ssh @SshCommonOpts $SshHost "echo $b64 | base64 -d | bash -l" | Out-Null
        return ($LASTEXITCODE -eq 0)
    }
    finally {
        $ErrorActionPreference = $prev
    }
}

function Invoke-RemoteQuiet([string]$Cmd) {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $normCmd = $Cmd -replace "\`r\`n", "\`n"
        $b64 = [System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($normCmd))
        return (& ssh @SshCommonOpts $SshHost "echo $b64 | base64 -d | bash -l" 2>$null)
    }
    finally {
        $ErrorActionPreference = $prev
    }
}

try {
    if ([string]::IsNullOrWhiteSpace($SshHost)) { throw "未配置远程 SSH 主机 (sshHost)" }
    if ([string]::IsNullOrWhiteSpace($RepoDir)) { throw "未配置远程代码仓库目录 (repoDir)" }
    if (-not (Test-IsPosixPath $RepoDir)) { throw "代码仓库目录必须为远程 Linux 路径(以 / 或 ~ 开头): $RepoDir" }
    if ([string]::IsNullOrWhiteSpace($ImageName)) { throw "未配置镜像名称 (imageName)" }
    if ([string]::IsNullOrWhiteSpace($DockerfilePath)) { throw "未配置 Dockerfile 路径" }

    $RepoDirNorm = if ($RepoDir.Trim() -eq "/") { "/" } else { $RepoDir.Trim().TrimEnd('/') }
    $RepoExpr = ConvertTo-BashPathExpr $RepoDirNorm
    $GitCheckExpr = if ($RepoDirNorm -eq "/") { "/.git" } else { "$RepoDirNorm/.git" }
    $GitExpr = ConvertTo-BashPathExpr $GitCheckExpr
    $FullImageTag = if ($ImageName -match ':') { $ImageName } else { "\${ImageName}:\${ImageTag}" }
    $BaseImageName = ($FullImageTag -split ':')[0]

    $TunnelSshArgs = @()
    $GitConfigFlags = ""
    if (-not [string]::IsNullOrWhiteSpace($GitTunnel)) {
        $entries = $GitTunnel -split '[,;\\s]+' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
        $flagParts = @()
        foreach ($entry in $entries) {
            if ($entry -notmatch '^(\\d+):([^:]+):(\\d+)$') {
                throw "反向隧道格式无效: $entry (格式: remotePort:targetHost:targetPort)"
            }
            $lPort = $matches[1]
            $rHost = $matches[2]
            $rPort = $matches[3]
            if ($TunnelSshArgs.Count -eq 0) {
                $TunnelSshArgs += @("-o", "ExitOnForwardFailure=yes")
            }
            $TunnelSshArgs += @("-R", "$entry")
            $localUrl = "http://127.0.0.1:\${lPort}/"
            $targetUrl = "http://\${rHost}:\${rPort}/"
            $flagParts += ("-c " + (ConvertTo-BashSingleQuoted "url.$localUrl.insteadOf=$targetUrl"))
            if ($rPort -eq "80") {
                $flagParts += ("-c " + (ConvertTo-BashSingleQuoted "url.$localUrl.insteadOf=http://$rHost/"))
            }
        }
        $GitConfigFlags = ($flagParts -join " ")
    }

    Write-Info "构建主机 (SSH): $SshHost"
    Write-Info "仓库目录: $RepoDirNorm"
    if (-not [string]::IsNullOrWhiteSpace($GitTunnel)) {
        Write-Info "Git 反向隧道: $GitTunnel"
    }
    Write-Info "目标镜像: $FullImageTag"

    $HasGitRepo = Test-RemoteBash ('test -d ' + $GitExpr)

    if (-not $HasGitRepo) {
        if (-not [string]::IsNullOrWhiteSpace($GitUrl)) {
            $NonEmptyCmd = 'test -e ' + $RepoExpr + ' && [ -n "$(ls -A ' + $RepoExpr + ' 2>/dev/null)" ]'
            if (Test-RemoteBash $NonEmptyCmd) {
                throw "远端目录已存在且非空(非 Git 仓库)，无法自动 clone: $RepoDirNorm"
            }
            Write-Step "Step 1: Git Clone ($SshHost)"
            Write-Info "正在克隆仓库: $GitUrl"
            $BranchArg = if (-not [string]::IsNullOrWhiteSpace($GitBranch)) { "-b $(ConvertTo-BashSingleQuoted $GitBranch) " } else { "" }
            $CloneBash = 'mkdir -p "$(dirname ' + $RepoExpr + ')" && git ' + $GitConfigFlags + ' clone ' + $BranchArg + (ConvertTo-BashSingleQuoted $GitUrl) + ' ' + $RepoExpr
            Invoke-RemoteBash $CloneBash "Git clone 失败，请检查仓库地址、分支、SSH 隧道与认证凭据" $TunnelSshArgs
            Write-Ok "Git clone 成功"
        }
        else {
            Invoke-RemoteBash ('test -d ' + $RepoExpr) "远端代码仓库目录不存在: $RepoDirNorm（可填写 Git 仓库地址以自动 clone）"
        }
    }
    elseif ((-not [string]::IsNullOrWhiteSpace($GitBranch)) -or $EnableGitPull) {
        Write-Step "Step 1: Git Sync ($SshHost)"
        if (-not [string]::IsNullOrWhiteSpace($GitBranch)) {
            $CurrBranchRaw = Invoke-RemoteQuiet ('cd ' + $RepoExpr + ' && git rev-parse --abbrev-ref HEAD')
            $CurrBranch = (($CurrBranchRaw -join "")).Trim()
            if ($CurrBranch -ne $GitBranch) {
                Write-Info "切换分支: $CurrBranch -> $GitBranch"
                $QBranch = ConvertTo-BashSingleQuoted $GitBranch
                $SwitchBash = "cd $RepoExpr && git $GitConfigFlags fetch origin $QBranch && (git checkout $QBranch || git checkout -b $QBranch origin/$QBranch)"
                Invoke-RemoteBash $SwitchBash "切换分支失败: $GitBranch" $TunnelSshArgs
            }
        }
        if ($EnableGitPull) {
            Write-Info "正在拉取最新代码..."
            $PullBash = if (-not [string]::IsNullOrWhiteSpace($GitBranch)) {
                "cd $RepoExpr && git $GitConfigFlags pull origin $(ConvertTo-BashSingleQuoted $GitBranch)"
            } else {
                "cd $RepoExpr && git $GitConfigFlags pull"
            }
            Invoke-RemoteBash $PullBash "Git pull 失败，请检查网络、反向隧道与分支状态" $TunnelSshArgs
            Write-Ok "Git pull 成功"
        }
    }

    $DockerNorm = $DockerfilePath.Trim() -replace '\\\\', '/'
    $ContextNorm = $BuildContext.Trim() -replace '\\\\', '/'
    $DockerArg = ConvertTo-BashPathExpr $DockerNorm
    $ContextArg = ConvertTo-BashPathExpr $ContextNorm

    $PreBuildCheck = "cd $RepoExpr && { [ ! -d .git ] || git log -1 --format='COMMIT:%h - %s (%ci)'; } && test -d $ContextArg && test -f $DockerArg"
    $CheckLines = Invoke-RemoteQuiet $PreBuildCheck
    $CheckExit = $LASTEXITCODE
    foreach ($line in $CheckLines) {
        if ($line -is [string] -and $line.StartsWith("COMMIT:")) {
            Write-Info ("当前 Commit: " + $line.Substring(7).Trim())
        }
    }
    if ($CheckExit -ne 0) {
        throw "Build context ($BuildContext) 或 Dockerfile ($DockerfilePath) 在远端不存在"
    }

    Write-Step "Step 2: Docker Build ($SshHost)"
    Write-Info "执行构建: docker build --progress=plain -t $FullImageTag -f $DockerNorm $ContextNorm"
    $BuildBash = "cd $RepoExpr && docker build --progress=plain -t $(ConvertTo-BashSingleQuoted $FullImageTag) -f $DockerArg $ContextArg"
    Invoke-RemoteBash $BuildBash "Docker build 失败"
    Write-Ok "Docker build 成功: $FullImageTag"

    $FinalRemoteTarFile = ""
    $FinalDownloadUrl = ""

    if ($EnableExport) {
        $EffectiveRemoteSaveDir = $RemoteSaveDir
        if ([string]::IsNullOrWhiteSpace($EffectiveRemoteSaveDir)) {
            throw "已勾选导出镜像，请填写远端导出目录 (remoteSaveDir)"
        }

        Write-Step "Step 3: Docker Save"
        $DateSuffix = Get-Date -Format "yyyyMMdd"
        $SafeBaseName = ($BaseImageName -replace '[\\\\/:*?"<>|]', '_')
        $TarFileName = "$SafeBaseName$DateSuffix.tar"

        $SaveDirNorm = $EffectiveRemoteSaveDir.TrimEnd('/')
        $TargetSaveDir = if ([string]::IsNullOrEmpty($SaveDirNorm)) { "/" } else { $SaveDirNorm }
        $RemoteTarFile = if ($TargetSaveDir -eq "/") { "/$TarFileName" } else { "$TargetSaveDir/$TarFileName" }
        $RemoteDirExpr = ConvertTo-BashPathExpr $TargetSaveDir
        $RemoteFileExpr = ConvertTo-BashPathExpr $RemoteTarFile

        Write-Info "正在保存镜像到远端: $RemoteTarFile"
        $SaveBash = "mkdir -p $RemoteDirExpr && docker save -o $RemoteFileExpr $(ConvertTo-BashSingleQuoted $FullImageTag) && chmod 644 $RemoteFileExpr"
        Invoke-RemoteBash $SaveBash "远端 docker save 失败"

        $SizeBytesRaw = (Invoke-RemoteQuiet "stat -c%s $RemoteFileExpr || wc -c < $RemoteFileExpr" | Select-Object -First 1)
        $FileSize = if ($SizeBytesRaw -match '^\\d+$') { Format-FileSize ([long]$SizeBytesRaw) } else { "未知大小" }
        $FinalRemoteTarFile = "$RemoteTarFile ($FileSize)"
        Write-Ok "远端镜像产物: $FinalRemoteTarFile"
        if (-not [string]::IsNullOrWhiteSpace($RemotePublicUrl)) {
            $FinalDownloadUrl = "$RemotePublicUrl/$TarFileName"
            Write-Ok "下载地址: $FinalDownloadUrl"
        }
    }

    if ($EnablePrune) {
        Write-Step "Step 4: Remote Cleanup ($SshHost)"
        $PruneBash = 'docker image prune -f && (docker builder prune -f --reserved-space=4GB || docker builder prune -f --keep-storage=4GB || docker builder prune -f --filter "until=168h" || true) && echo "--- Disk Usage ---" && df -h /'
        Invoke-RemoteBash $PruneBash "远端清理缓存失败"
    }

    Write-Step "Build 完成"
    Write-Ok "镜像: $FullImageTag @ $SshHost"
    if (-not [string]::IsNullOrWhiteSpace($FinalRemoteTarFile)) {
        Write-Ok "远端文件: $FinalRemoteTarFile"
    }
    if (-not [string]::IsNullOrWhiteSpace($FinalDownloadUrl)) {
        Write-Ok "下载链接: $FinalDownloadUrl"
    }
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
    XON_PIPE_REMOTE_SAVE_DIR: p.remoteSaveDir,
    XON_PIPE_REMOTE_PUBLIC_URL: p.remotePublicUrl,
    XON_PIPE_SSH_HOST: p.sshHost,
    XON_PIPE_GIT_TUNNEL: p.gitTunnel,
    XON_PIPE_PRUNE: p.pruneAfterBuild ? "1" : "0",
  };
  return {
    cmd: getBootstrapCommand(),
    shell: "powershell",
    // 置空 cwd: 远程构建由 ssh.exe 驱动,不依赖本地仓库路径
    cwd: "",
    env,
  };
}
