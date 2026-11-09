# MMI Jar System

Split your monthly budget into jars and track where every peso goes. Works on any phone through the browser, and can be added to the home screen like a normal app.

## What's inside

- **Home**: budget left, days left, safe amount to spend per day, your jars, recent expenses
- **Jars**: edit names, shares (%), and colors, add new jars, archive old ones. Warns you if the jars don't add up to 100%
- **History**: this month or all time, search, grouped by day, tap any expense to edit or delete
- **Insights**: total vs budget (shows how far over, not capped at 100%), daily pace without bills, spending by jar and by category, month by month
- **Add expense**: amount, jar, title, date, category, and payment method (Cash, GCash, Maya, Card, Bank transfer)

Default jars: Necessities 55%, Financial Freedom 10%, Long-Term Savings 10%, Education 10%, Play 10%, Giving 5%.

## Two modes

| Mode | When | Data lives |
|---|---|---|
| Local | `config.js` keys are empty | On that one browser |
| Cloud | `config.js` has Supabase keys | In Supabase, each user has their own account |

## Setup (about 15 minutes)

### 1. Put the code on GitHub
1. Go to github.com > New repository > name it `mmi-jar-system` > Create.
2. Click "uploading an existing file" and drag in all the files from this folder (keep the `supabase` folder). Commit.

### 2. Create the database
1. Go to supabase.com > New project (you can use the same account as your gym tracker).
2. Open SQL Editor > New query, paste everything from `supabase/schema.sql`, click Run.
3. Go to Authentication > Sign In / Providers > Email. For quick testing you can turn off "Confirm email". Turn it back on before you share the app.
4. Go to Project Settings > API. Copy the Project URL and the `anon` public key.

### 3. Connect the keys
Open `config.js` on GitHub, click the pencil, paste the two values, commit:

```js
window.MMI_CONFIG = {
  SUPABASE_URL: "https://xxxx.supabase.co",
  SUPABASE_ANON_KEY: "eyJ..."
};
```

The anon key is safe to put in the code. Row Level Security in the schema stops users from seeing each other's data.

### 4. Go live on Vercel
1. vercel.com > Add New > Project > import `mmi-jar-system`.
2. Framework preset: Other. No build command. Deploy.
3. In Supabase > Authentication > URL Configuration, set Site URL to your Vercel link.

### 5. Put it on your phone
Open the Vercel link in Safari > Share > Add to Home Screen.

## Sharing with other people
Send them the Vercel link. They tap "Create account", set their budget, and get their own jars.

## Files

```
index.html          app shell
styles.css          design
app.js              all app logic
config.js           your Supabase keys
manifest.json       home screen app settings
icon.svg            app icon
supabase/schema.sql database tables and security
```
