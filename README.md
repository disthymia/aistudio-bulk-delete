# AI Studio Multi-Prompt & Turn Bulk Delete

A lightweight, zero-permission Chrome/Edge extension (Manifest V3) that adds multi-select checkboxes (`Shift+Click` supported) and bulk deletion to [Google AI Studio](https://aistudio.google.com).

## Features
- **In Chat**: Adds a checkbox to the top-right of each message turn so you can bulk-delete multiple turns at once.
- **In History**: Adds checkboxes to saved chat rows for batch cleanup.
- **Shift+Click** range selection + **Select All / Clear / Stop** controls.
- **Privacy & Safety**: 100% client-side, zero network requests, no background scripts, and scoped strictly to `https://aistudio.google.com/*`.

## How to Install (Chrome / Edge)
1. Download and unzip the latest release (or clone this repo).
2. Open `chrome://extensions` (Chrome) or `edge://extensions` (Edge).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select the extracted folder.
5. Refresh Google AI Studio.

## Notes
- Test on 1–2 dummy items first.
- AI Studio saves chats to Google Drive on a background debounce timer—after a bulk delete in a long chat, wait a few seconds (or make a tiny edit / **Make a copy**) before refreshing so Drive sync catches up.
