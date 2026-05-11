# Hosting on GitHub Pages

This project is configured to deploy automatically to GitHub Pages using GitHub Actions.

## How it works
- A workflow in `.github/workflows/deploy-pages.yml` runs tests on pull requests and pushes to `main`.
- On pushes to `main`, deployment waits for the test job to pass.
- The workflow uploads the repository contents as a Pages artifact.
- GitHub Pages serves the static site from the artifact.

## One-time GitHub configuration
1. In your GitHub repository, go to **Settings** → **Pages**.
2. Under **Build and deployment**, select **GitHub Actions** as the source.

## Custom domains (optional)
If you want to use a custom domain, add a `CNAME` file at the repo root with your domain, then update DNS to point at GitHub Pages.
