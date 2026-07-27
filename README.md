# TeamBoard

A simple, no-login shared project board (a mini Monday.com) for your team.
Anyone with the link can open it and edit the same live data.

- **Projects** in the left sidebar
- **Tasks** under each project — with a title, an **owner**, a **due date**, and a colored **status**
- **People** you can assign (managed from the "People" button in the header)
- Changes save to a shared **Vercel Postgres** database and auto-refresh every few seconds, so teammates see each other's edits
- Brand colors: `#5B5859` (gray) and `#CBCE00` (lime)

---

## Deploy it (about 5 minutes, one time)

You'll need [Node.js](https://nodejs.org) installed and a free [Vercel](https://vercel.com) account.

### 1. Install dependencies
From inside this `teamboard` folder:

```bash
npm install
```

### 2. Deploy to Vercel
```bash
npm install -g vercel
vercel
```
Accept the defaults when prompted (it links/creates a project and deploys). You'll get a URL.

### 3. Add the shared database
In your [Vercel dashboard](https://vercel.com/dashboard):
1. Open the **teamboard** project → **Storage** tab
2. **Create Database** → **Postgres** → choose the free plan → **Create**
3. **Connect** it to the teamboard project (this automatically adds the `POSTGRES_URL` environment variables — nothing to copy)

### 4. Redeploy so it picks up the database
```bash
vercel --prod
```

That's it. Open the production URL — the app builds its own tables on first load. Share the link with your team; everyone edits the same board.

> **Tip:** Prefer clicking over the command line? You can instead push this folder to a GitHub repo and use **Add New → Project** in the Vercel dashboard to import it, then do steps 3–4 there.

---

## Run it locally (optional)
Local dev needs a database connection string in a `.env.local` file:

```bash
# .env.local  (get these values from Vercel → Storage → your DB → .env.local tab)
POSTGRES_URL="postgres://..."
```
Then:
```bash
npm run dev
```
and open http://localhost:3000

---

## How the data is organized
- **people** — `id, name, color`
- **projects** — `id, name`
- **tasks** — `id, project_id, title, assignee_id, due_date, status`

Statuses: `Not Started`, `Working on it`, `Stuck`, `Done`. Deleting a project deletes its tasks; deleting a person un-assigns their tasks.
