# Publish official status as static snapshots

The Housing Authority PDFs do not allow browser requests from a public dashboard origin. A scheduled GitHub Action parses the PDFs and publishes only court-level snapshots and changes to GitHub Pages; the browser keeps applicant identifiers and preferences locally. This trades exact 15-minute timing and on-demand upstream fetches for free static hosting, a reviewable history and no public write API. "Refresh now" only reloads the latest published snapshot.
