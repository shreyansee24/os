# Vault – Smart File Storage & Disk Space Analyzer

Vault is a local, read-only storage analysis dashboard built with Flask, SQLite, HTML, CSS, JavaScript and Chart.js.

## Requirements
- Windows 10/11
- Python 3.10 or newer
- VS Code (recommended)

## Run on Windows
1. Extract `vault.zip`.
2. Open the extracted `vault` folder in VS Code.
3. Open Terminal → New Terminal.
4. (Recommended) Create a virtual environment:
   ```powershell
   py -m venv .venv
   .\.venv\Scripts\Activate.ps1
   ```
5. Install dependencies:
   ```powershell
   pip install -r requirements.txt
   ```
6. Start Vault:
   ```powershell
   python app.py
   ```
7. Open **http://127.0.0.1:5000/** in your browser.
8. Click **Choose folder**, select a directory in the native Windows folder dialog, set the large-file threshold in MB, and click **Start scan**.

## Features
- Real local directory scans using filesystem metadata.
- Folder sizes include files in nested subfolders; folder rows are ordered largest first.
- File inventory with name, extension/category, size and full location.
- Search, size sorting, category filtering and minimum-size filtering.
- Configurable large-file threshold.
- File category distribution and folder usage charts (Chart.js).
- Data-driven recommendations and possible temporary-file review suggestions.
- SQLite scan history.
- Rescan support and graceful reporting of inaccessible files.
- Symlinked files and directories are skipped; directory symlinks are not traversed.
- No file is deleted, moved, renamed or modified.

## Project structure
```text
vault/
├── app.py
├── requirements.txt
├── README.md
├── templates/
│   └── index.html
├── static/
│   ├── css/style.css
│   └── js/script.js
└── data/
    └── vault_history.sqlite3  # created automatically after first run
```

## Notes and limitations
- The folder picker uses Python's native Tkinter dialog. Run the Flask server on the same Windows computer as the browser.
- Scanning is synchronous: the browser shows an activity indicator while the local scan runs. Very large trees can take time.
- Some protected folders may return permission errors. Vault skips inaccessible entries where possible and lists a sample of errors.
- Folder totals are inclusive: a parent folder's size includes files in all descendant folders. Therefore, do not add parent and child rows together.
- This app does not calculate free disk capacity; it reports the size of files inside the selected directory.
- Chart.js is loaded from its public CDN, so an internet connection is required for charts. The rest of the app runs locally.
