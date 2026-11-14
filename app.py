from flask import Flask, render_template, request, jsonify
from pathlib import Path
from collections import defaultdict
import os, hashlib, sqlite3, threading, time, traceback

app = Flask(__name__)
app.config["JSON_SORT_KEYS"] = False
DATA_DIR = Path(__file__).parent / "data"
DB_PATH = DATA_DIR / "vault_history.sqlite3"
DATA_DIR.mkdir(exist_ok=True)
SCAN_LOCK = threading.Lock()
LATEST = {"scan_id": None, "root": None, "files": [], "folders": [], "summary": {}, "categories": {}, "errors": []}

CATEGORIES = {
    "Documents": {".pdf", ".doc", ".docx", ".txt", ".rtf", ".ppt", ".pptx", ".xls", ".xlsx", ".odt", ".csv"},
    "Images": {".jpg", ".jpeg", ".png", ".svg", ".gif", ".bmp", ".webp", ".tif", ".tiff", ".heic"},
    "Videos": {".mp4", ".mkv", ".avi", ".mov", ".wmv", ".webm", ".m4v"},
    "Audio": {".mp3", ".wav", ".aac", ".flac", ".ogg", ".m4a", ".wma"},
    "Archives": {".zip", ".rar", ".7z", ".tar", ".gz", ".bz2"},
    "Applications": {".exe", ".msi", ".app", ".dmg", ".deb", ".rpm", ".apk", ".bat", ".cmd", ".sh"},
    "Code": {".py", ".js", ".ts", ".html", ".css", ".java", ".c", ".cpp", ".h", ".hpp", ".php", ".go", ".rs", ".json", ".xml", ".sql", ".ipynb"},
}
def category_for(path):
    ext = Path(path).suffix.lower()
    for category, extensions in CATEGORIES.items():
        if ext in extensions:
            return category
    return "Other"

def init_db():
    with sqlite3.connect(DB_PATH) as con:
        con.execute("""CREATE TABLE IF NOT EXISTS scans (
            id INTEGER PRIMARY KEY AUTOINCREMENT, scanned_at TEXT DEFAULT CURRENT_TIMESTAMP,
            root TEXT NOT NULL, total_bytes INTEGER NOT NULL, file_count INTEGER NOT NULL,
            folder_count INTEGER NOT NULL, large_count INTEGER NOT NULL)""")
init_db()

def format_size(n):
    units = ["B", "KB", "MB", "GB", "TB"]
    value = float(n)
    for unit in units:
        if value < 1024 or unit == units[-1]:
            return f"{value:.1f} {unit}" if unit != "B" else f"{int(value)} B"
        value /= 1024
    return f"{value:.1f} TB"

def scan_directory(root, threshold):
    root_path = Path(root).resolve(strict=True)
    if not root_path.is_dir():
        raise ValueError("The selected path is not a directory.")
    records, folder_sizes, folder_counts, errors = [], defaultdict(int), defaultdict(int), []
    folder_set = {str(root_path)}
    def walk_error(exc):
        errors.append(f"Could not access {getattr(exc, 'filename', 'directory')}: {exc}")
    for current, dirs, filenames in os.walk(root_path, topdown=True, onerror=walk_error, followlinks=False):
        current_path = Path(current)
        # Never traverse symlinked directories.
        safe_dirs = []
        for dirname in dirs:
            candidate = current_path / dirname
            try:
                if candidate.is_symlink():
                    continue
                safe_dirs.append(dirname)
                folder_set.add(str(candidate))
            except OSError:
                errors.append(f"Could not inspect folder: {candidate}")
        dirs[:] = safe_dirs
        for filename in filenames:
            path = current_path / filename
            try:
                if path.is_symlink() or not path.is_file():
                    continue
                stat = path.stat(follow_symlinks=False)
                size = stat.st_size
                parent = str(path.parent)
                folder_sizes[parent] += size
                folder_counts[parent] += 1
                records.append({
                    "name": path.name, "path": str(path), "folder": parent,
                    "extension": path.suffix.lower() or "(no extension)",
                    "category": category_for(path), "size": size,
                    "size_display": format_size(size), "modified": stat.st_mtime,
                    "large": size >= threshold
                })
            except (PermissionError, OSError) as exc:
                errors.append(f"Skipped {path}: {exc}")
    # Include empty folders and roll child-folder sizes into ancestors.
    all_folder_sizes = defaultdict(int)
    all_folder_counts = defaultdict(int)
    for folder in folder_set:
        all_folder_sizes[folder] += folder_sizes.get(folder, 0)
        all_folder_counts[folder] += folder_counts.get(folder, 0)
    for folder, size in folder_sizes.items():
        parent = Path(folder).parent
        while parent != root_path.parent and str(parent).startswith(str(root_path)):
            if str(parent) != folder:
                all_folder_sizes[str(parent)] += size
                all_folder_counts[str(parent)] += folder_counts.get(folder, 0)
            if parent == root_path:
                break
            parent = parent.parent
    folders = [{
        "name": Path(p).name or p, "path": p, "size": s,
        "size_display": format_size(s), "file_count": all_folder_counts.get(p, 0)
    } for p, s in all_folder_sizes.items()]
    folders.sort(key=lambda x: x["size"], reverse=True)
    categories = defaultdict(int)
    for item in records:
        categories[item["category"]] += item["size"]
    total = sum(x["size"] for x in records)
    records.sort(key=lambda x: x["size"], reverse=True)
    summary = {
        "total_bytes": total, "total_size": format_size(total),
        "file_count": len(records), "folder_count": len(folder_set),
        "large_count": sum(1 for x in records if x["size"] >= threshold),
        "threshold": threshold, "threshold_display": format_size(threshold),
    }
    return records, folders, dict(categories), summary, errors, str(root_path)

def make_recommendations(files, folders, categories, summary):
    tips = []
    if not files:
        return ["No files were found in this scan. Choose a folder containing files to see storage recommendations."]
    if summary["large_count"]:
        tips.append(f"{summary['large_count']} file(s) meet your large-file threshold ({summary['threshold_display']}). Review the largest items before deciding whether they are still needed.")
    if folders and folders[0]["size"] > summary["total_bytes"] * 0.5:
        tips.append(f"“{folders[0]['name']}” accounts for more than half of the scanned data. Review its contents and subfolders.")
    largest = files[:3]
    if largest and largest[0]["size"] > summary["total_bytes"] * 0.2:
        tips.append(f"The largest file, “{largest[0]['name']}” ({largest[0]['size_display']}), is a substantial share of this scan.")
    temp_exts = {".tmp", ".temp", ".bak", ".old", ".log", ".cache"}
    temp_files = [f for f in files if Path(f["name"]).suffix.lower() in temp_exts]
    if temp_files:
        temp_total = sum(f["size"] for f in temp_files)
        tips.append(f"Found {len(temp_files)} possible temporary/backup/log file(s) using {format_size(temp_total)}. Check whether they are still required.")
    if categories.get("Videos", 0) > summary["total_bytes"] * 0.3:
        tips.append("Video files use over 30% of scanned space. Consider reviewing old exports or duplicate recordings.")
    if not tips:
        tips.append("No unusual storage concentration was detected. Review the largest files periodically to keep storage under control.")
    tips.append("Vault is read-only: it never deletes, moves, renames, or edits your files.")
    return tips

@app.get("/")
def index():
    return render_template("index.html")

@app.post("/api/select-folder")
def select_folder():
    # Native picker runs on the same computer as this local Flask server.
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        selected = filedialog.askdirectory(title="Select a folder to scan")
        root.destroy()
        if not selected:
            return jsonify({"cancelled": True})
        return jsonify({"path": str(Path(selected).resolve())})
    except Exception as exc:
        return jsonify({"error": f"Could not open the folder picker: {exc}. Enter a folder path manually instead."}), 500

@app.post("/api/scan")
def start_scan():
    data = request.get_json(silent=True) or {}
    folder = (data.get("path") or "").strip()
    try:
        threshold_mb = float(data.get("threshold_mb", 100))
        if threshold_mb < 0:
            raise ValueError("Threshold cannot be negative.")
        threshold = int(threshold_mb * 1024 * 1024)
        if not folder:
            raise ValueError("Choose or enter a folder path first.")
        if not Path(folder).expanduser().exists():
            raise ValueError("The selected folder does not exist or is not accessible.")
        with SCAN_LOCK:
            records, folders, categories, summary, errors, root = scan_directory(folder, threshold)
            with sqlite3.connect(DB_PATH) as con:
                cur = con.execute("INSERT INTO scans(root,total_bytes,file_count,folder_count,large_count) VALUES(?,?,?,?,?)",
                    (root, summary["total_bytes"], summary["file_count"], summary["folder_count"], summary["large_count"]))
                scan_id = cur.lastrowid
            LATEST.update({"scan_id": scan_id, "root": root, "files": records, "folders": folders,
                           "categories": categories, "summary": summary, "errors": errors})
        return jsonify({"ok": True, "scan_id": scan_id, "root": root, "summary": summary,
                        "errors": errors[:30], "recommendations": make_recommendations(records, folders, categories, summary)})
    except (ValueError, OSError, PermissionError) as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        app.logger.exception("Scan failed")
        return jsonify({"error": f"Scan failed safely: {exc}"}), 500

@app.get("/api/results")
def results():
    if LATEST["scan_id"] is None:
        return jsonify({"ok": False, "message": "No scan has been run yet."}), 404
    return jsonify({"ok": True, "scan_id": LATEST["scan_id"], "root": LATEST["root"],
        "summary": LATEST["summary"], "files": LATEST["files"],
        "folders": LATEST["folders"], "categories": LATEST["categories"],
        "recommendations": make_recommendations(LATEST["files"], LATEST["folders"], LATEST["categories"], LATEST["summary"]),
        "errors": LATEST["errors"][:30]})

@app.get("/api/folders")
def folder_stats():
    return jsonify({"folders": LATEST["folders"]})

@app.get("/api/categories")
def category_stats():
    return jsonify({"categories": LATEST["categories"]})

@app.get("/api/large-files")
def large_files():
    try:
        minimum = int(request.args.get("minimum", 0))
    except ValueError:
        minimum = 0
    category = request.args.get("category", "all")
    records = [f for f in LATEST["files"] if f["size"] >= minimum and (category == "all" or f["category"] == category)]
    return jsonify({"files": records})

@app.get("/api/recommendations")
def recommendations():
    return jsonify({"recommendations": make_recommendations(LATEST["files"], LATEST["folders"], LATEST["categories"], LATEST["summary"])})

@app.get("/api/history")
def history():
    with sqlite3.connect(DB_PATH) as con:
        con.row_factory = sqlite3.Row
        rows = con.execute("SELECT * FROM scans ORDER BY id DESC LIMIT 30").fetchall()
    return jsonify({"history": [dict(row) for row in rows]})

@app.errorhandler(404)
def not_found(_):
    if request.path.startswith("/api/"):
        return jsonify({"error": "API endpoint not found."}), 404
    return render_template("index.html"), 404

@app.errorhandler(500)
def server_error(_):
    if request.path.startswith("/api/"):
        return jsonify({"error": "An unexpected server error occurred. Check the Flask terminal for details."}), 500
    return "Internal server error. Check the Flask terminal for details.", 500

if __name__ == "__main__":
    print("Vault is running at http://127.0.0.1:5000/")
    app.run(host="127.0.0.1", port=5000, debug=False, threaded=True)
