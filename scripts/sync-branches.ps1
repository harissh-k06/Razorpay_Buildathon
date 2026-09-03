<#
.SYNOPSIS
    Generic branch synchronization script to mirror a source branch (e.g. master) into a target branch (e.g. main).

.DESCRIPTION
    Ensures the target branch is an exact byte-for-byte replica of the source branch,
    and pushes the synchronized target branch to the remote repository.

.PARAMETER SourceBranch
    The branch to copy from. Defaults to "master".

.PARAMETER TargetBranch
    The branch to overwrite. Defaults to "main".

.PARAMETER Remote
    The remote repository name. Defaults to "origin".

.PARAMETER Push
    Whether to push the synchronized target branch to the remote. Defaults to $true.

.EXAMPLE
    .\scripts\sync-branches.ps1
    .\scripts\sync-branches.ps1 -SourceBranch master -TargetBranch main
#>

param(
    [string]$SourceBranch = "master",
    [string]$TargetBranch = "main",
    [string]$Remote = "origin",
    [switch]$NoPush = $false
)

$ErrorActionPreference = "Stop"

Write-Host "=== Generic Branch Sync: $SourceBranch -> $TargetBranch ===" -ForegroundColor Cyan

# 1. Verify git repository
try {
    $currentBranch = (git branch --show-current).Trim()
} catch {
    Write-Error "Not a valid git repository or git command failed."
    exit 1
}

Write-Host "Current active branch: $currentBranch" -ForegroundColor Yellow

# 2. Check working tree status
$statusOutput = git status --porcelain
if ($statusOutput) {
    Write-Host "Notice: Working tree has modified or untracked files." -ForegroundColor Yellow
    Write-Host "Stashing working tree before synchronization..." -ForegroundColor Cyan
    git stash push -u -m "pre-sync-auto-stash"
    $stashed = $true
} else {
    $stashed = $false
}

try {
    # 3. Fetch latest references
    Write-Host "Fetching remote refs from $Remote..." -ForegroundColor Cyan
    git fetch $Remote $SourceBranch
    
    # 4. Check out target branch resetting hard to source branch
    Write-Host "Switching to '$TargetBranch' and resetting to '$SourceBranch'..." -ForegroundColor Cyan
    git checkout -B $TargetBranch $SourceBranch
    
    # 5. Push to remote
    if (-not $NoPush) {
        Write-Host "Pushing exact copy of '$SourceBranch' to '$Remote/$TargetBranch'..." -ForegroundColor Cyan
        git push $Remote "${TargetBranch}:${TargetBranch}" --force
        Write-Host "Successfully pushed '$TargetBranch' to '$Remote'!" -ForegroundColor Green
    } else {
        Write-Host "NoPush flag specified. Skipping remote push." -ForegroundColor Yellow
    }
} finally {
    # 6. Switch back to original branch
    Write-Host "Switching back to original branch: $currentBranch..." -ForegroundColor Cyan
    git checkout $currentBranch
    
    # 7. Restore stash if created
    if ($stashed) {
        Write-Host "Restoring stashed changes..." -ForegroundColor Cyan
        git stash pop --index
    }
}

Write-Host "=== Sync completed successfully: $TargetBranch is now an exact copy of $SourceBranch! ===" -ForegroundColor Green
