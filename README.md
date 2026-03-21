# Smritix

Smritix is a modern, responsive, and locally-hosted note-taking application designed for a seamless user experience. It features a sleek note editor with a dynamic taskbar, emoji support, and rich text capabilities, all running on your own machine.

## Features

- **Modern UI**: A visually appealing note editor with rich interactions and a dynamic taskbar.
- **Rich Text Support**: Markdown integration for formatting your notes easily.
- **Auto Setup Wizard**: Handles the first-time setup for configuring your database and environment automatically.
- **Standalone Launch Scripts**: One-click start on both Windows (`.bat`) and macOS/Linux (`.sh`).
- **Local First**: Keep your notes entirely on your own device with a local SQLite database.

## Architecture

The project is structured into two main components:
- **Backend**: A modern Python Flask server providing the API and managing the local database.
- **Frontend**: Lightweight vanilla HTML, CSS, and JavaScript for maximum performance and flexibility.

### Key Files and Directories

```text
smritix_final/
├── backend/          # Flask application, routing, config, and database logic
├── frontend/         # HTML/CSS/JS frontend assets
├── launcher.py       # Main entry point and Flask server management
├── requirements.txt  # Python package dependencies
```

## Getting Started

### Prerequisites

- **Python 3.8** or higher installed on your system.
- Git (optional, for version control).

### Running the Application

Depending on your operating system, double-click or run the appropriate setup script. These scripts will automatically set up a virtual environment, install the necessary dependencies, start the server, and launch the application in your default web browser.

**Windows:**
Double-click `setup_dev.bat` or run the following in your command prompt:
```bat
setup_dev.bat
```

**macOS/Linux:**
Run the shell script in your terminal:
```bash
bash setup_dev.sh
```

**Manual Start:**
If you already have your environment set up and the requirements installed, simply run the launcher:
```bash
python launcher.py
```
This starts the backend on a dynamically chosen port and opens `http://127.0.0.1:<port>` in your default browser.

## Development

- To run the server without opening the UI automatically in the browser, start with `python launcher.py --no-browser`.
- **Frontend Development:** UI code is located in the `frontend/` directory. Simply modify the HTML, CSS, or JS files and reload the page in your browser.
- **Backend Development:** Back-end routing and logic are handled in `backend/app.py` and `backend/routes/`. The database setup is defined in `backend/database.py`.
