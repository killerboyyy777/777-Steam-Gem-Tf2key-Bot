// -------------------------------------------------------------
// Modified Version of Steam-Gem-Key-Bot
// Original Author: mfw (https://steamcommunity.com/id/mfwBan)
// Original License: GNU General Public License v3.0 (GPLv3)
// 
// Modifications and maintenance by killerboyyy777 (https://steamcommunity.com/id/klb777)
// Changes include:
//    - Enhanced API communication
//    - Implemented AutoGem weekly conversion feature (previously only a config value)
//    - Updated profit tracking system
//    - Compatibility fixes and improved logging
// © 2025 killerboy777 – Licensed under the same GPLv3
// -------------------------------------------------------------


module.exports = {
    // Steam Account Credentials
    USERNAME: "",
    PASSWORD: "",
    IDENTITYSECRET: "",
	SHAREDSECRET: "",
    
    INVITETOGROUPID: "103582791474038795", // Steam Group ID, where new friends are invited
	STEAMAPIKEY: "", // Steam Web API Key
    
	
	MAXMSGPERSEC: 3, // Max messages allowed per second before user is blocked
	Owner: ["",""],  // [Bot SteamID64, Admin SteamID64, ...]
	Comment_After_Trade: "+Rep! Thanks for Trading with me!",  // Comment to post after a successful trade (empty string if none)
	Ignore_Msgs: [], // SteamIDs of users/bots to ignore messages and trade offers from

    Rates: { 
		
		// Buy Rates (Bot buys keys/items from the user)
		BUY:{ 
			Gems_To_TF2_Rate:4200, // User gives us X Gems for X of OUR TF2 Keys
			BG_And_Emotes: 10 // Buy THEIR Backgrounds & Emotes for X Gems Each 
		},
		
		// Sell Rates (Bot sells keys/items to the user)
		SELL:{ 
			TF2_To_Gems: 3900, // User gives us X TF2 Keys for Our X Gems
			BG_And_Emotes: 25 // Sell YOUR Backgrounds & Emotes for X Gems Each 
		},
	},
	Restrictions:{
		MaxSell: 0, // Max TF2 keys user can sell to bot in one trade
		MaxBuy: 0, // Max TF2 keys user can buy from bot in one trade
		Convert_To_Gems: 0, // Minimum gem value for an item to be automatically gemmed
		ItemsNotForTrade: [ // List names of items here to prevent them from being traded by the bot
			':cleancake:',
			':cleankey:',
			'A Clean Garage',
			':cleandino:',
			':cleanfloppy:',
			':dustpan:',
			':featherduster:',
			':cleanhourglass:',
			':goldfeatherduster:',
			'A Work-in-Progress Garage',
			':cleanseal:',
			'A Slightly Cleaner Garage',
			'A Messy Garage',
			'Dirty and Dusty',
			'All Tidied Up',
		]
	},
	MESSAGES: {
    WELCOME:
      'Hello! Welcome to my bot! I trade Gems/Keys. Use !help to see all commands.',
    HELP:
      'Commands: \r\n\r\n'
      + '!Prices ⮞ Displays all current buy/sell prices. \r\n\r\n'
      + '!Check ⮞ Checks your current inventory for tradeable items. \r\n\r\n'
      + '!BuyTF [# of TF2 Keys] ⮞ Buy TF2 Keys for Gems \r\n\r\n'
      + '!SellTF [# of TF2 Keys] ⮞ Sell TF2 Keys for Gems \r\n\r\n'
      + "We're also:\r\n"
      + 'Buying Your Backgrounds & Emotes for 9 Gems each! \r\n'
      + '(Only Gemable Backgrounds and Emotes) \r\n'
      + 'Just start a Trade Offer with me and enter any/ all Emoticons/Backgrounds you would like to sell! '
      + 'Then, Add the correct rate of gems from my inventory into the trade. '
      + '(10 Gems per Emote/BG) Bot will auto accept if rates match/will decline if they do not. \r\n', 
    ADMINHELP:
      'Admin Commands:\r\n\r\n'
      + '!Admin ⮞ Displays this admin help menu.\r\n'
      + '!Profit ⮞ Shows current profit statistics (Keys, Gems, Sets, etc.).\r\n'
      + '!Block [SteamID64] ⮞ Blocks a specific user from interacting with the bot.\r\n'
      + '!Unblock [SteamID64] ⮞ Unblocks a previously blocked user.\r\n'
      + '!Broadcast ⮞ Sends the configured message to all friends of the bot.\r\n\r\n',
  },
	TF2_Keys: [
		"Mann Co. Supply Crate Key" // List of TF2 Key names
	],
	CSGO_Keys: [] // List of CS:GO Key names (empty)
};