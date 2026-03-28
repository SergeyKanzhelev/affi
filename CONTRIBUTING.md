# Contributing to Affi

Thank you for your interest in contributing to Affi!

## Development Workflow

### Prerequisites
- **Node.js & npm:** For running unit tests (Jest).
- **Python 3:** For running the statistics generation pipeline.
- **Go:** Required by the `maintainers` tool used in the statistics pipeline.

### Setup
1. Clone the repository.
2. Run `make install` to install dependencies.
3. For Firefox development, run `make sync-firefox`. This creates a Firefox-compatible version of the extension in the `firefox/` directory.

### Testing
Always ensure tests pass before submitting a Pull Request:
```bash
make test
```
You can also verify UI changes using the E2E test page:
1. Run `make serve`.
2. Open `http://localhost:8080/tests/e2e.html` in your browser.

#### Testing in Firefox
To test the extension directly in Firefox:
1. Run `make sync-firefox` to prepare the `firefox/` directory.
2. Open Firefox and type `about:debugging` in the address bar.
3. Click on **"This Firefox"** (or **"This Nightly"**) in the left sidebar.
4. Click the **"Load Temporary Add-on..."** button.
5. Navigate to your project folder, enter the `firefox/` directory, and select the `manifest.json` file.
6. The extension is now loaded and will remain active until you restart Firefox.

#### Testing in Chrome
To test the extension in Chrome:
1. Open Chrome and type `chrome://extensions` in the address bar.
2. Enable **"Developer mode"** using the toggle in the top right corner.
3. Click the **"Load unpacked"** button.
4. Select the project's root directory (containing the main `manifest.json`).
5. The extension is now loaded. You can click the "Refresh" icon on the extension card after making changes to the source code.

## Release Process

When a new version is ready to be released, follow these steps:

### 1. Versioning and Tagging
1.  **Update Version:** Incremented the version number in `manifest.json` (root) and `firefox/manifest.json.src`.
2.  **Synchronize:** Run `make sync-firefox` to ensure the Firefox folder is up to date.
3.  **Commit:** Commit the version change:
    ```bash
    git add .
    git commit -m "Release vX.Y.Z"
    ```
4.  **Tag:** Create a git tag:
    ```bash
    git tag vX.Y.Z
    ```
5.  **Push:** Push the commit and the tag:
    ```bash
    git push origin main
    git push origin vX.Y.Z
    ```

### 2. Packaging
Run the packaging command to generate the store-ready ZIP files:
```bash
make dist
```
This will create:
- `affi-chrome.zip`
- `affi-firefox.zip`

### 3. Chrome Web Store Submission
1.  Go to the [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole/).
2.  Select the **Affi** extension.
3.  Click **Package** in the left menu.
4.  Click **Upload new package** and select `affi-chrome.zip`.
5.  Fill in any updated store listing details.
6.  Click **Submit for review**.

### 4. Firefox Add-ons (AMO) Submission
1.  Go to the [Firefox Add-ons Developer Hub](https://addons.mozilla.org/developers/).
2.  Click on the **Affi** extension.
3.  Click **Upload New Version** in the left menu.
4.  Upload `affi-firefox.zip`.
5.  The system will validate the package.
6.  Provide any necessary "Information for Reviewers" (e.g., source code link if requested).
7.  Click **Submit Version**.

## Code Standards
- **Idiomatic JavaScript:** Follow standard JS patterns.
- **Modularity:** Keep parsing logic in `parser.js` and UI logic in `ui.js`.
- **CSS:** Use classes instead of IDs to support multiple instances in the E2E test page.
- **Documentation:** Update `README.md` if adding new features or changing workflows.
