# 🎟 Ticket Price Comparator

Compare live ticket prices across Ticketmaster, SeatGeek, and StubHub side by side.

## Why a server?

Browsers block direct API calls from web pages to third-party APIs (CORS policy).
This app uses a tiny Node.js proxy server that makes the API calls server-side,
then forwards the results to the browser — bypassing CORS entirely.

## Setup (takes ~1 minute)

### 1. Make sure Node.js is installed
Download from https://nodejs.org if needed. Any version 14+ works.

### 2. Start the server
Open a terminal in this folder and run:

```
node server.js
```

You should see:
```
✅ Ticket Comparator running at http://localhost:3000

   Ticketmaster API : ✅ key loaded
   SeatGeek API     : ✅ key loaded
   StubHub API      : ⚠️  not configured (using estimates)
```

### 3. Open the app
Open your browser and go to: **http://localhost:3000**

That's it — search for any event and see live prices from all platforms!

---

## API Keys

All keys are stored in `server.js` at the top of the file:

```js
const TM_KEY = 'your-ticketmaster-key';
const SG_ID  = 'your-seatgeek-client-id';
const SG_SEC = 'your-seatgeek-secret';
const SH_KEY = null; // Add StubHub key here
```

### Adding StubHub
When you have your StubHub API key, replace `null` with your key string.
The app will automatically switch from estimated to live StubHub prices.

---

## Features

- ✅ Live Ticketmaster prices via Discovery API
- ✅ Live SeatGeek prices via Events API  
- ⚠️  StubHub estimated (±20% market variance) until key added
- 🏆 Auto-highlights "Best Price" and "Best Value" (with fees)
- 💰 Shows exact savings vs. most expensive option
- 🔀 Smart event merging — same event from both platforms shown as one row
- 🎵 Filter by Music, Sports, Theater & Arts, Comedy
- 📊 Sort by date, lowest price, or best savings
