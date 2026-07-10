# Cloud Environments — Command Installation Guide

## Overview

Tripplet's cloud environments now support installing and running command-line packages via pip. When you run `pip install claude-code` (or any other CLI package), the installed command becomes available for subsequent executions.

---

## How It Works

### 1. Virtual Environment Isolation
- Each cloud environment gets its own Python virtual environment (`.venv`)
- pip installs packages into this isolated environment
- All installed commands are available in the environment's `bin` directory

### 2. Command Resolution
The system resolves commands in this order:
1. **Virtual Environment Bin** — Check `.venv/bin/` for pip-installed scripts (highest priority)
2. **System PATH** — Fall back to system-installed commands if not found in venv

### 3. Entry Point Generation
When you install a package with CLI entry points (like `claude-code`):
- The package installation creates wrapper scripts in `.venv/bin/`
- These scripts are automatically discovered and executable
- Setup tools and wheel are pre-installed to ensure proper entry point generation

---

## Usage Examples

### Install and Use CLI Packages

```bash
# Install a Python package with a CLI command
pip install claude-code

# Run the installed command
claude --help

# The command is now available for all future executions in this environment
```

### Check Installed Packages

```bash
# List all installed packages and available commands
pip list

# Or use the special installed-commands shorthand
installed-commands

# Find where a specific command is located
which claude
```

### Install with Dependencies

```bash
# Install package with specific version
pip install claude-code==1.2.3

# Install multiple packages at once
pip install requests numpy pandas

# Install from requirements file
pip install -r requirements.txt
```

### Verify Installation

```bash
# Check if claude is available
which claude

# Get version info
claude --version

# Run a command
claude some-command --option value
```

---

## Environment Features

### Pre-installed Tools
- **pip** — Package installer for Python
- **python3** — Python interpreter
- **setuptools** — Package installation tools
- **wheel** — Built distribution format support

### Available Special Commands

#### `pip` (Python Package Installer)
```bash
pip install <package>      # Install a package
pip install -r requirements.txt  # Install from requirements
pip list                   # List installed packages
pip show <package>        # Show package info
pip uninstall <package>   # Uninstall a package
pip upgrade <package>     # Upgrade a package
```

#### `which` (Command Lookup)
```bash
which claude              # Find where 'claude' command is
which python             # Find Python interpreter
```

#### `installed-commands` or `pip-list` (Custom)
```bash
installed-commands       # List all installed packages AND available commands
```

#### `python` / `python3` (Python Interpreter)
```bash
python script.py         # Run a Python script
python -c "print('hi')"  # Run Python code inline
python -m pip install ... # Run pip via Python module
```

---

## Complete Workflow Example

Here's a complete example of using cloud environments with CLI packages:

```bash
# Step 1: Install a CLI package
pip install claude-code

# Step 2: Verify it was installed
which claude

# Step 3: Check installed packages
installed-commands

# Step 4: Use the command
claude init my-project

# Step 5: Install additional dependencies
pip install requests

# Step 6: Run your application
claude start
```

---

## Path & Environment Setup

### Virtual Environment Variables
When commands run, the following environment is set:

```
PATH = {venv-bin}:{system-path}
VIRTUAL_ENV = {workspaceDir}/.venv
HOME = {workspaceDir}
PIP_DISABLE_PIP_VERSION_CHECK = 1
PYTHONUNBUFFERED = 1
```

### Workspace Structure
```
cloud-env-{slug}/
├── .venv/                  # Virtual environment
│   ├── bin/               # Executable scripts
│   ├── lib/               # Installed packages
│   └── ...
├── your-files/            # Your project files
└── requirements.txt       # (optional) For tracking dependencies
```

---

## Troubleshooting

### Command Not Found After Install

**Problem:** Installed a package but the command isn't available.

**Solution:**
1. Verify the package installed: `pip list | grep package-name`
2. Check the command name: Different from package name sometimes
3. Try using Python to run it: `python -m package_name`

### Package Installation Fails

**Problem:** `pip install` errors out.

**Solutions:**
- Check Python version: `python --version`
- Upgrade pip: `python -m pip install --upgrade pip`
- Try without cached files: `pip install --no-cache-dir package-name`
- Check available disk space and permissions

### Command Runs But Fails

**Problem:** Command installs but fails when executed.

**Solution:**
- Check the command's version: `command --version`
- Verify dependencies: `pip list`
- Try running with Python: `python -m command`
- Check the command's documentation

### Accessing Files Created by Commands

All files created in the workspace are automatically captured and returned in the response. They'll be available for download or reuse in the next execution.

---

## Best Practices

### 1. Document Dependencies
Create a `requirements.txt` for reproducibility:
```bash
pip freeze > requirements.txt
pip install -r requirements.txt
```

### 2. Use Virtual Environments Consistently
- Keep all installations within the cloud environment
- Don't mix system packages with venv packages

### 3. Pin Versions for Stability
```bash
pip install claude-code==1.2.3    # Specific version
pip install "requests>=2.28.0"    # Version constraints
```

### 4. Check Installation Location
```bash
which my-command          # Shows: /home/cloud/{slug}/.venv/bin/my-command
```

---

## Integration with Claude Code

When used with the Claude Code platform:

1. **Install packages** via `pip install` in your cloud environment
2. **Use installed CLIs** in subsequent commands
3. **Keep workspace state** — Files and packages persist across commands
4. **Version consistency** — Same version of tools run each time

Example Claude Code workflow:
```bash
# Claude Code command 1
pip install claude-code mypy pytest

# Claude Code command 2
mypy src/
pytest tests/
claude lint --fix
```

---

## Advanced: Custom Entry Points

If you're building a Python package with CLI entry points:

```python
# setup.py or pyproject.toml
[project.scripts]
my-command = "my_package.cli:main"
```

When you `pip install` this package, the `my-command` script is automatically created and available.

---

## Support

For issues with:
- **pip/Python** — See Python and pip documentation
- **Specific packages** — Check the package's GitHub/documentation
- **Cloud environment** — Contact support with your environment slug

---

## Example: Installing and Using claude-code

```bash
# 1. Install
pip install claude-code

# 2. Verify
which claude

# 3. Initialize a project
claude init my-project

# 4. Run claude code
claude generate --feature "login page"

# 5. Install test dependencies
pip install pytest pytest-cov

# 6. Run tests
pytest tests/ --cov

# 7. See all installed tools
installed-commands
```

---

This system enables a full-featured Python development and CLI execution environment in the cloud. Install once, use repeatedly!
