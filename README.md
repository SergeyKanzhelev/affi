# Affi - Kubernetes OWNERS Hierarchy & Stats

Affi is a Chrome extension designed for Kubernetes developers and maintainers. It provides an interactive overlay when viewing `OWNERS` and `OWNERS_ALIASES` files on GitHub, making it easier to understand maintainer hierarchies and contribution activity.

## Features

- **Hierarchical OWNERS View:** Automatically traverses from the repository root down to the current directory to show all relevant `OWNERS` files.
- **Intelligent Truncation:** Respects the `no_parent_owners: true` flag, providing visual feedback (`❌ no_parent_owners`) when the hierarchy stops.
- **Interactive Alias Expansion:** Resolves aliases using the `OWNERS_ALIASES` file and allows expanding them into a list of GitHub handles with one click.
- **Contributor Activity Stats:** Toggleable statistics for individual maintainers, showing both repository-specific and global (across all Kubernetes repos) activity.
- **Visual Engagement Cues:** Intuitively identifies active, low-activity, and completely inactive maintainers based on PR comments and DevStats scores.
- **Direct GitHub Links:** Every maintainer handle is a clickable link to their GitHub profile.

## Project Structure

- `content.js`: Core extension logic for DOM manipulation and navigation handling.
- `parser.js`: Modular logic for parsing `OWNERS` YAML and individual line analysis.
- `generate_stats.py`: A Python pipeline that uses the `maintainers` Go tool to build the activity database.
- `maintainers_stats.json`: The generated JSON database containing activity metrics for the Kubernetes ecosystem.
- `tests/`: A comprehensive Jest-based unit test suite.
- `Makefile`: Streamlined targets for testing and statistics generation.

## Installation (Developer Mode)

1. Clone this repository.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** (toggle in the top right).
4. Click **Load unpacked** and select the project directory.

## Statistics Generation

To update the maintainer statistics database:

1. Ensure you have [Go](https://go.dev/) and [Python 3](https://www.python.org/) installed.
2. Run `make generate-stats` to fetch and parse data for all Kubernetes and kubernetes-sigs repositories.
3. Refresh the extension in Chrome.

## Testing

The project uses Jest for unit testing. To run the tests:

```bash
make test
```

## Contributing

Contributions are welcome! Please ensure that all new features include corresponding unit tests and that `make test` passes before submitting a PR.

## License

MIT
