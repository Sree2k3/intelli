# PowerShell helper to bootstrap frontend and backend environments
# Run this from the repository root: `./scripts/setup.ps1`.

Write-Host "Setting up backend virtual environment..."
Push-Location backend
if (-not (Test-Path ".venv")) {
    python -m venv .venv
}
# Activate environment and install requirements
& .\.venv\Scripts\Activate.ps1
pip install --upgrade pip
pip install -r requirements.txt
Pop-Location

Write-Host "Installing frontend dependencies..."
npm install

Write-Host "Bootstrap complete."