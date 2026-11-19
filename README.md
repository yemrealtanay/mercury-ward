# Mercury Ward

**A free data privacy awareness initiative for the UK estate agency industry.**

The long-term goal is a scanner that inspects every network request an estate agency website makes and reports on UK GDPR and PECR issues. **v1** does one thing: it reads the site's `sitemap.xml`, looks for people's first and last names in the text of each page, and emails the findings as `report.csv`.

Mercury Ward is an awareness tool and does not constitute legal advice.

## How v1 works

1. The form at `/` takes an email, name, company, the domain to scan and an optional ignore list.
2. `POST /scan` cleans the domain, validates the email, writes a row to SQLite, queues the scan and redirects to `/thanks.html`.
3. The scanner reads `https://<domain>/sitemap.xml`. If that fails it tries the `Sitemap:` lines in `robots.txt` and then `/sitemap_index.xml`. Sitemap indexes are followed up to 2 levels deep, `.gz` sitemaps are supported, and at most 500 URLs are taken.
4. Pages are fetched one by one with a 1 second pause. Each request (and each redirect hop) is checked first: only http/https on ports 80/443, only the same site (`www.` and subdomains count), and the hostname must resolve to a public IP (SSRF protection).
5. HTML is turned into plain text (no script/style) and searched for names.
6. When the scan finishes the report is emailed as a branded HTML email (with a plain-text part) and `report.csv` attached. No findings → an email with no attachment. If no sitemap is found, only the home page is scanned. If no page can be read or the scan errors → a "could not scan" email and the row is marked `failed`.

**Storage:** only the registration and a scan summary are kept (who, which domain, when, page count, hit count, error). Names found and the ignore list live in memory only and are discarded after the email is sent.

**Name detection** ([detectors/names.js](detectors/names.js)): two capitalised words side by side where the first is a known first name ([data/first_names.txt](data/first_names.txt)) and the second is not an address, company or common word (`Road`, `Street`, `Ltd`, `Lettings`, `Your`…). Each hit includes 40 characters of context either side and repeated names on a page are merged. Every detector follows the same contract, so an LLM-based detector can be dropped in later by changing one import in `server.js`:

```js
async function detect(text, ignore) // -> [{ name, context, count }]
```

## Files

| File | Purpose |
| --- | --- |
| `server.js` | Form POST, validation, SQLite record, scan queue, rate limit |
| `scanner.js` | Domain cleaning, sitemap reading, safe fetching, HTML to text |
| `detectors/names.js` | Name detection |
| `mailer.js` | CSV and report / failure emails (SendGrid, Resend, SMTP or console) |
| `email-template.js` | HTML email layout in the site's style |
| `public/` | Landing page with the form, thank-you page |
| `data/first_names.txt` | First-name list |
| `test/` | Unit tests (`node --test`) |

## Run locally

Requires Node.js 22.13 or newer (uses the built-in `node:sqlite`, so there are no native dependencies).

```bash
npm install
cp .env.example .env
npm test
npm start   # http://localhost:3000
```

With no `SENDGRID_API_KEY`, `RESEND_API_KEY` or `SMTP_HOST`, emails are not sent; they are printed to the console as JSON with the attachment.

## Deploy on Railway

1. Create a new project from this GitHub repo. Railway detects Node from `package.json` / `.node-version` and uses `railway.json` for the start command and the `/healthz` health check.
2. Add a **volume** to the service (for example mounted at `/data`). The app picks up `RAILWAY_VOLUME_MOUNT_PATH` automatically and stores `mercuryward.db` there. Without a volume the database is lost on every deploy.
3. Set the variables:
   - An email API key and `MAIL_FROM`. Railway blocks outbound SMTP on the Free and Hobby plans, so use an HTTP API:
     - **SendGrid:** `SENDGRID_API_KEY` (a key with the *Mail Send* permission). `MAIL_FROM` must be a verified Single Sender or on an authenticated domain.
     - **Resend:** `RESEND_API_KEY`, with `MAIL_FROM` on a domain verified in Resend.
     - If several are set, SendGrid wins, then Resend, then `SMTP_*` (SMTP only works on the Pro plan).
   - Optional: `MAIL_REPLY_TO`, `MAX_URLS`, `REQUEST_DELAY_MS`, `MAX_QUEUE`, `RATE_LIMIT_PER_HOUR` (`0` turns the limit off while testing), `PUBLIC_URL` (link for the "Scan another website" button; defaults to Railway's public domain).
4. Generate a public domain under the service's **Networking** settings.

Run a single replica: the queue lives in memory. A scan running during a redeploy is lost and its row is marked `failed` when the app starts again.

To look at the scan log, open a shell on the service (`railway ssh`) and run:

```bash
node -e "const {DatabaseSync}=require('node:sqlite');console.table(new DatabaseSync(process.env.RAILWAY_VOLUME_MOUNT_PATH+'/mercuryward.db').prepare('select * from scans order by id desc limit 20').all())"
```

## Out of scope for v1

LLM detection, domain ownership checks, email confirmation links, user accounts and a results page, phone/address/bank detail detection, image checks, a persistent queue, robots.txt rules and JavaScript-rendered content. A small in-memory rate limit (5 scans per hour per IP and per email) and a queue cap are included because the form is public.

## About

Mercury Ward is an **Iceberg X** initiative, designed and built by **Iceberg Digital**.
*Elevating human potential.*
