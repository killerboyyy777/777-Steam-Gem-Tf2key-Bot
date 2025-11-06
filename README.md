# Steam-Gem-Key-Bot

[![Node.js](https://img.shields.io/badge/Node.js-v20+-green?logo=node.js)](https://nodejs.org/)
[![License](https://img.shields.io/github/license/killerboyyy777/777-Steam-Gem-Tf2key-Bot.svg?label=License)](https://github.com/killerboyboy777/777-Steam-Gem-Tf2key-Bot/blob/main/LICENSE)
[![GitHub Release Version](https://img.shields.io/github/v/release/killerboyyy777/777-Steam-Gem-Tf2key-Bot?label=Version&logo=github)](https://github.com/killerboyyy777/777-Steam-Gem-Tf2key-Bot/releases)
[![Price](https://img.shields.io/badge/Price-FREE-blue.svg)]()

[![Last Commit](https://img.shields.io/github/last-commit/killerboyyy777/777-Steam-Gem-Tf2key-Bot.svg?label=Updated)](https://github.com/killerboyyy777/777-Steam-Gem-Tf2key-Bot/commits/main)
[![GitHub Stars](https://img.shields.io/github/stars/killerboyyy777/777-Steam-Gem-Tf2key-Bot?style=social&label=Stars)](https://github.com/killerboyyy777/777-Steam-Gem-Tf2key-Bot/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/killerboyyy777/777-Steam-Gem-Tf2key-Bot?style=social&label=Forks&logo=github)](https://github.com/killerboyyy777/777-Steam-Gem-Tf2key-Bot/network/members)
[![Open Issues](https://img.shields.io/github/issues/killerboyyy777/777-Steam-Gem-Tf2key-Bot.svg?label=Issues)](https://github.com/killerboyyy777/777-Steam-Gem-Tf2key-Bot/issues)

**Free Release** of my automated Steam Bot for trading **Gems (💎), TF2 Keys (🔑), Emotes, and Profile Backgrounds**.

I am releasing this project for free simply to counteract the practice of selling similar bots at excessively high prices.

---

## 🚀 Usage (Getting Started)

To start and use the Bot, follow these steps:

### 1. Installation
1. Clone this Repository or Download the .zip.
2. Navigate to the Home Folder of the Project.
3. **Execute `install.bat`** (This will install all required node.js Dependencies.)

### 2. Configuration
Read the Instructions in the **"Tutorial"** Folder or follow the steps below:

1.  Navigate to the `SETTINGS` folder.
2.  Open the `config.js` file with a text editor.
3.  Fill in your Steam account credentials (`USERNAME`, `PASSWORD`, `SHAREDSECRET`, `IDENTITYSECRET`).
4.  Set your SteamID64 in the `Owner` array.
5.  Customize the trading rates and other settings to your liking.

---

## 🤖 Bot Features

*   **Automatic Trading:** Trades Gems, TF2 Keys, Emotes, and Profile Backgrounds automatically.
*   **Configurable Pricing:** Easily configure your own pricing rates for all items.
*   **Admin Commands:** Manage the bot with admin commands, including profit checking, user blocking, and broadcasting messages.
*   **Spam Protection:** Automatically blocks users who spam the bot with messages.
*   **Automatic Item Conversion:** Automatically converts items to gems based on your configured value.
*   **Caching:** Caches inventories and user profiles to reduce Steam API calls and improve performance.

---

## 🤖 Bot Commands & Automated Features

### Basic Commands

| Command | Description |
| :--- | :--- |
| `!Info` | Info about Owner. |
| `!Price(s)` / `!Rate(s)` | Check Bot's Rates/Prices. |
| `!Check` | Check how many 🔑s & 💎s you have to see what we have to offer you! |

### Trading Commands

| Command | Syntax | Description | Status |
| :--- | :--- | :--- | :--- |
| `!BuyTF` | `!BuyTF [Number of TF2 🔑s]` | Buy BOTS TF2 🔑s for YOUR 💎s. | ✅ Working |
| `!SellTF` | `!SellTF [Number of TF2 🔑s]` | Sell YOUR TF2 🔑s for BOTS 💎s. | ✅ Working |
| `!BuyCS` | `!BuyCS [Number of CS:GO 🔑s]` | Buy BOTS CS:GO 🔑s for YOUR 💎s. | ❌ OUTDATED (Steam Changes) |
| `!SellCS` | `!SellCS [Number of CS:GO 🔑s]` | Sell YOUR CS:GO 🔑s for BOTS 💎s. | ❌ OUTDATED (Steam Changes) |

### Swapping Commands

| Command | Syntax | Swap Action | Status |
| :--- | :--- | :--- | :--- |
| `!SwapCS` | `!SwapCS [Number of CS:GO 🔑s]` | Swap YOUR CS:GO 🔑s for OUR TF2 🔑s. | ❌ OUTDATED (Steam Changes) |
| `!SwapTF` | `!SwapTF [Number of TF2 🔑s]` | Swap YOUR TF2 🔑s for OUR CS:GO 🔑s. | ❌ OUTDATED (Steam Changes) |

### Automated Features (Emotes/Backgrounds)

*   **Automatic Trading:** The bot will automatically accept trade offers for emotes and backgrounds that match the configured prices. It can both buy and sell these items for gems.
*   **Automatic Gem Conversion:** The bot will automatically convert items to gems if their gem value is higher than the configured `Convert_To_Gems` value. This process runs on startup and then once a week.
*   **Caching:** The bot caches inventories and user profiles to reduce the number of requests made to the Steam API. This improves performance and avoids API rate limits.

---

## 🤝 Contributing

Contributions are welcome! If you want to improve this bot, please feel free to fork the repository and submit a pull request.

### Bug Reports & Feature Requests

Please open an issue on the [GitHub repository](https://github.com/killerboyyy777/777-Steam-Gem-Tf2key-Bot/issues) for any bug reports or feature requests.

### Pull Requests

1.  Fork the repository.
2.  Create a new branch for your feature or bug fix.
3.  Make your changes.
4.  Submit a pull request with a clear description of your changes.

---

## ❤️ Donations / Support

If you find this bot useful and would like to support the continued development and maintenance, you can send a small donation.

Every contribution is highly appreciated!

| Method | Details |
| :--- | :--- |
| **Steam Trade** | `https://steamcommunity.com/tradeoffer/new/?partner=1211192445&token=T9Hiu3Oz` |
| **Litecoin (LTC)** | `ltc1qjr49nr028mcajlt7prmmnqnjh0552qjj90zdq4` |
| **Monero (XMR)** | `82oJRDdiSWWbem3HiYx7ZdDdiPkYQAW4LaGNHpNcJ9DCendQ3XcxHNYQiRMtfghYtSMmARPGqKe2ddSrhtjviTraEyGwgZ2` |

---
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

📜 License

This project is licensed under the [GNU General Public License v3.0 (GPLv3)](LICENSE).

Inspired by work from mfw (https://steamcommunity.com/id/ndevs).
Recoded and Maintained © 2025 killerboyyy777 (https://steamcommunity.com/id/klb777).
