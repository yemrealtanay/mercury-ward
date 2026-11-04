# Mercury Ward

**A free data privacy awareness initiative for the UK estate agency industry.**

Mercury Ward will scan an estate agency website, inspect every network request it makes, and produce a plain-English report on data privacy issues, such as:

- Trackers, pixels and cookies that load before consent
- Personal data (names, emails, phone numbers, postcodes) leaking into URLs or third-party requests
- Cookie banner quality: is rejecting as easy as accepting, and are choices respected?
- Session replay and heatmap tools recording form inputs
- Transport security: HTTP form posts, mixed content, security headers, cookie flags
- Transparency signals: privacy notice, cookie policy, controller details

The checks are designed around **UK GDPR** and **PECR**. Mercury Ward is an awareness tool and does not constitute legal advice.

## Status

🚧 **Coming soon.** This repository currently hosts the project's landing page (`index.html`).

## Run the landing page locally

```bash
python3 -m http.server 8080
```

Then open <http://localhost:8080>.

## About

Mercury Ward is an **Iceberg X** initiative, designed and built by **Iceberg Digital**.
*Elevating human potential.*
