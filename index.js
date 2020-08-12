const Discord = require('discord.js');
const client = new Discord.Client();
const _ = require('underscore');
const { prefix, emoji, cmd, roles, roledists } = require('./config.json');
const { token } = require('./token.json');

const promptMsg = `@here React ${emoji.join} to join the game! After everyone has joined, react ${emoji.start} to start.`;
const timeoutMsg = 'The game was not started in time. Please try again.';
const cancelMsg = 'The game has been cancelled.';
const existingGameErrorMsg = `There is already a game in progress. To cancel this game, use \`${prefix} ${cmd.cancel[0]}\`.`;
const loggingDisabledMsg = `Logging is disabled for this game.`;
const mentionedPlayersErrorMsg = `Error - None of the mentioned users are players in this game.`;
const noGameErrorMsg = 'There are no games currently in progress.';
const gameOverMsg = '\n:boom: :boom: :boom: **GAME OVER** :boom: :boom: :boom:\n';
const hundredCowboyMsg = '                  :cowboy:\n            :100::100::100:\n      :100:      :100:      :100:\n:point_down:         :100::100:         :point_down:\n          :100:          :100:\n          :100:          :100:\n           :boot:          :boot:';

const debug = false;
var game = {};
resetGame();

client.once('ready', () => { console.log('Ready!'); });

client.on('message', message => {
	if (!message.content.startsWith(prefix) || message.author.bot) return;
	var args = message.content.toLowerCase().split(' ').slice(1);

	if (!args.length && message.channel.type != 'dm') {
		postGamePromptMessage(message.channel);
	} else if (cmd.custom.includes(args[0]) && args[1] && message.channel.type != 'dm') {
		postGamePromptMessage(message.channel, args[1]);
	} else if (args.length && args[0].startsWith(cmd.mention) && message.mentions.users.size > 0 && message.channel.type != 'dm') {
		processGameChange(message, args);
	} else if (cmd.remain.includes(args[0])) {
		postRemainingRoles(message.channel);
	} else if (cmd.cancel.includes(args[0]) && message.channel.type != 'dm') {
		cancelGame(message.channel);
	} else if (cmd.rules.includes(args[0])) {
		postRulesMessage(message.channel, args[1]);
	} else {
		postHelpMessage(message, args);
	}
});

client.login(token);

// BOT FUNCTIONS

async function postGamePromptMessage(channel, args) {
	if (game.inProgress) {
		channel.send(existingGameErrorMsg);
		return;
	}

	// If a custom role distribution was passed, set it
	var customGameMsg = '';
	if (args && getRolesFromArgs(args)) {
		if (args.split('').filter(char => !(['s','d','o','r','b'].includes(char))).length > 0) {
			channel.send(`Error - Invalid custom game role codes. The role codes are: S(heriff), D(eputy), O(utlaw), R(enegade), and B(eggar).`);
			return;
		}
		game.roleDist = getRolesFromArgs(args);
		game.reqdPlayerCount = args.length;
		customGameMsg += ` This custom game requires exactly **${game.reqdPlayerCount} players** to start.\n`;
		if (!game.roleDist.sheriff || game.roleDist.sheriff.length > 1 || !game.roleDist.outlaw || game.roleDist.outlaw.length > 1) {
			customGameMsg += `\n_Warning: Game logging commands are disabled because this game does not have the required roles (at least 1 Sheriff and at least 1 Outlaw)._`;
			game.loggingEnabled = false;
		}
	}

	// Send game start message and start reaction listener
	const message = await channel.send(promptMsg + customGameMsg);
	await toggleBotReactionOnGamePrompt(message, emoji.join, true);

	const filter = (reaction, user) => {
		return [emoji.join,emoji.start].includes(reaction.emoji.name) && !user.bot;
	};
	const collector = message.createReactionCollector(filter, { time: 30000, dispose: true });
	const joinEmojiConditions = (p) => { return p.size === 0; }
	const startEmojiConditions = (p) => { return (game.reqdPlayerCount && p.size === game.reqdPlayerCount) || roledists[p.size] != undefined; }

	collector.on('collect', async (reaction) => {
		if (reaction.emoji.name === emoji.join) {
			// Toggle the game join/start reactions based on player count
			var players = await getUsersWithReaction(message, emoji.join);
			// console.log('checking start emoji conditions');
			toggleBotReactionOnGamePrompt(message, emoji.start, startEmojiConditions(players));
			toggleBotReactionOnGamePrompt(message, emoji.join, joinEmojiConditions(players));
		} else if (reaction.emoji.name === emoji.start) {
			// TODO solve starting two games at once?
			// If we have enough players, start a game!
			var players = await getUsersWithReaction(message, emoji.join);
			if (!game.inProgress && players.size === game.reqdPlayerCount || roledists[players.size]) {
				startGame(channel, players);
				collector.stop();
			}
		}
	});

	collector.on('remove', async (reaction) => {
		// Toggle the game ready reaction based on player count
		if (reaction.emoji.name === emoji.join) {
			var players = await getUsersWithReaction(message, emoji.join);
			toggleBotReactionOnGamePrompt(message, emoji.start, startEmojiConditions(players));
			toggleBotReactionOnGamePrompt(message, emoji.join, joinEmojiConditions(players));
		}
	});

	collector.on('end', () => {
		if (!game.inProgress) {
			channel.send(timeoutMsg);
		}
	});
}

function startGame(channel, players) {
	game.inProgress = true;
	game.roleDist = game.roleDist ? game.roleDist : roledists[players.size];
	game.players = players;
	game.roles = {sheriff:[],deputy:[],outlaw:[],renegade:[],beggar:[]};
	game.dead = [];

	// Make a list of roles and randomly assign players to them
	var roleStrs = [];
	var playersToAssign = _.shuffle(game.players.array());
	_.each(game.roleDist, (roleCount, roleName) => {
		for (var i = 0; i < roleCount; i++) {
			var player = playersToAssign.shift();
			player.send(
				`Howdy! Your role is **${roleName.capitalize()}**.\n` + 
				`${roles[roleName].short}\n\n` + 
				`Reply \`${prefix} ${cmd.rules[0]} ${roleName}\` to get the detailed rules text for this role.`
			);
			game.roles[roleName].push(player);
			player.role = roleName;
		}

		// Stringify role counts for confirmation message
		if (roleCount > 0) {
			roleStrs.push(`${roleCount} ` + (roleCount > 1 ? roles[roleName].plural : roleName).capitalize());
		}
	});

	// Format and send confirmation message
	var confirmationMsg = `Roles have been assigned! This game has ${roleStrs.toListString()}.\n`;
	confirmationMsg += game.roles.sheriff.length ? `${game.roles.sheriff[0].toString()} will be your Sheriff this game. Good luck, y'all!` : "...nobody's Sheriff? Weird. Hope y'all know what yer doin'!";
	channel.send(confirmationMsg);
}

function processGameChange(message, args) {
	if (debug && !game.players) {
		playerCount = Math.floor(6 + (Math.random() * 2));
		var names = _.shuffle(['brian','max','ryan','jeff','joe','mike','dan','tim']);
		game = {
			inProgress: true,
			roleDist: roledists[playerCount],
			players: new Map(),
			roles:{sheriff:[],deputy:[],outlaw:[],renegade:[],beggar:[]},
			dead:[]
		};
		_.each(game.roleDist, (count, role) => {
			for (var i = 0; i < count; i++) {
				var name = names.pop().capitalize();
				game.players.set(name, {id:name,username:name,role:role,send:(msg)=>{console.log(`DM for ${this.username}:\n${msg}\n`)}});
				game.roles[role].push(game.players.get(name));
			}
		});
		message.channel.send(`Starting a debug game with ${playerCount} players: ${game.players.keys().toListString()}`);
	}

	if (!game.inProgress) {
		message.channel.send(noGameErrorMsg);
		return;
	} else if (!game.loggingEnabled) {
		message.channel.send(loggingDisabledMsg);
		return;
	}

	var mentionedPlayers = [];
	var sourcePlayer = null;
	var gameOver = false;
	var winners = {sheriff:[],deputy:[],outlaw:[],renegade:[],beggar:[]};
	var drawers = {sheriff:[],deputy:[],outlaw:[],renegade:[],beggar:[]};
	var died = (player) => player.dead;

	if (debug) {
		var shuffledLivingPlayers = _.shuffle(game.players.keys().filter(p => !game.dead.includes(game.players.get(p))));
		if (Math.random() > 0.25) { mentionedPlayers.push(game.players.get(shuffledLivingPlayers[0])) }
		var r = 1;
		while (r > Math.random() && shuffledLivingPlayers.length) {
			shuffledLivingPlayers = _.shuffle(shuffledLivingPlayers)
			mentionedPlayers.push(shuffledLivingPlayers.shift());
			r /= 7;
		}
	} else {
		mentionedPlayers = getSortedMentionedUsers(message).filter(u => game.players.get(u.id) != undefined);
		if (!mentionedPlayers.length) {
			message.channel.send(mentionedPlayersErrorMsg);
			return;
		}
	}

	var gameStateMsg = (debug && !game.dead.length) ? '`new game`\n' : '';

	// Use args to determine processing mode: win, draw, or loss
	var textArg = args.filter(arg => !arg.startsWith('<@'))[0];
	if (cmd.log.win.includes(textArg)) {
		console.log('process a win');
		mentionedPlayers.forEach((player) => {
			if (player.role === 'sheriff' || player.role === 'deputy') {
				winners.sheriff.push(...game.roles.sheriff);
				winners.deputy.push(...game.roles.deputy);
			} else if (player.role === 'outlaw') {
				winners.outlaw.push(...game.roles.outlaw);
			} else {
				winners[player.role].push(player);
			}

			// Reveal winning players with hidden roles
			if (player.role != 'sheriff') {
				gameStateMsg += `${player.username.capitalize()} wins! ` +
				`They were... ${game.roles[player.role].length > 1 ? roles[player.role].article : 'the'} **${player.role.capitalize()}**!\n`;
			}
		});
		gameOver = 'win';
	} else if (cmd.log.draw.includes(textArg)) {
		console.log('process a draw');
		mentionedPlayers.forEach((player) => {
			drawers[player.role].push(player);
		});
		gameOver = 'draw';
	} else if (cmd.log.loss.includes(textArg)) {
		console.log('process losses');
		console.log(mentionedPlayers);
		sourcePlayer = mentionedPlayers.length > 1 ? mentionedPlayers.shift() : null;
		console.log(sourcePlayer);

		game.dead.push(...mentionedPlayers);

		mentionedPlayers.forEach((player) => {
			player.dead = true;
			
			console.log('processing dead player');
			console.log(player);

			// Check Beggar win con
			if (player.role === 'beggar' && sourcePlayer && player.id != sourcePlayer.id) {
				winners.beggar.push(player);
				gameOver = 'win';
			}

			// Reveal losing players and reveal their role
			if (player.role === 'sheriff') {
				gameStateMsg += `**Sheriff ${player.username.capitalize()}** is out!\n`;
			} else {
				gameStateMsg += `${player.username.capitalize()} is out! ` +
				`They were... ${game.roles[player.role].length > 1 ? roles[player.role].article : 'the'} **${player.role.capitalize()}**!` +
				`${player.exBeggar ? ` _(previously ${game.roles.beggar.length > 1 ? roles.beggar.article : 'the'} **Beggar**)_` : ''}\n`;
			}
		});

		// If there are any beggars, assign them a new role
		if (game.roles.beggar.length) {
			console.log('assigning beggar new role');
			var newRoles = [];
			game.roles.beggar.forEach((player, idx) => {
				if (!player.winner && !player.dead) {
					player.exBeggar = true;
					var validBeggarRoles = mentionedPlayers.filter(p => p.role != 'sheriff');
					var newRole = validBeggarRoles.length ? _.shuffle(validBeggarRoles)[0].role : null;
					if (newRole) {
						game.players.get(player.id).role = newRole;
						game.roles[newRole].push(player);
						game.roles.beggar.splice(idx, 1);
						newRoles.push(newRole);
						player.send(
							`Your role is now **${newRole.capitalize()}**.\n`  + 
							`${roles[newRole].short}\n\n` + 
							`Reply \`${prefix} ${cmd.rules[0]} ${newRole}\` to get the detailed rules text for this role.`
						);
					}
				}
			});
			// Append any role changes to the message.
			if (newRoles.length) {
				gameStateMsg += '\n';
				newRoles.forEach((newRole) => {
					gameStateMsg += `${newRoles.length > 1 ? 'A' : 'The'} Beggar is now ${game.roles[newRole].filter(p => !p.exBeggar).length > 1 ? roles[newRole].article : 'the'} **${newRole.capitalize()}**.\n`;
				});
			}
		}
		
		// Check Sheriff & Deputy win con
		if (game.roles.outlaw.every(died)) {
			console.log('sheriff and deputy victory condition achieved!');
			if (!game.roles.sheriff.concat(game.roles.deputy).every(died)) {
				winners.sheriff.push(...game.roles.sheriff);
				winners.deputy.push(...game.roles.deputy);
				gameOver = 'win';
			} else {
				drawers.sheriff.push(...game.roles.sheriff);
				drawers.deputy.push(...game.roles.deputy);
				gameOver = 'draw';
			}
		}
		// Check Outlaw win con
		if (game.roles.sheriff[0].dead) {
			console.log('outlaw victory condition achieved!');
			if (!game.roles.outlaw.every(died)) {
				winners.outlaw.push(...game.roles.outlaw);
				gameOver = 'win';
			} else {
				drawers.outlaw.push(...game.roles.outlaw);
				gameOver = 'draw';
			}
		}
		// Check Renegade win con
		if (!game.roles.renegade.every(died)) {
			if (game.dead.length >= (Math.ceil(game.players.size / 2))) {
				console.log('renegade victory condition achieved!');
				game.roles.renegade.forEach((player) => {
					if (!player.dead) { 
						winners.renegade.push(player);
						gameOver = 'win';
					} else if (drawers.length && mentionedPlayers.includes(player)) {
						drawers.renegade.push(player);
						gameOver = 'draw';
					}
				});
			}
		}
	} else {
		message.channel.send(`Error - ${textArg ? 'Invalid' : 'No'} text argument included with player mentions.`);
		return;
	}

	// If we have winners or a draw, append that to the message
	if (gameOver) {
		gameStateMsg += gameOverMsg;
		if (gameOver === 'win') {
			_.each(winners, (players, role) => {
				if (players.length) {
					if (role === 'deputy') {
						gameStateMsg += `**Sheriff ${winners.sheriff[0].username.capitalize()}** and `;
					}
					if (!(role === 'sheriff' && winners.deputy.length)) {
						gameStateMsg += `**${(players.length > 1 ? roles[role].plural : role).capitalize()} ${getUsernames(winners[role], true).toListString()}** win${(players.length > 1 || role === 'deputy') ? '' : 's'}!\n`;
					}
				}
			});
		} else { // 'draw'
			var drawList = []
			_.each(drawers, (players, role) => {
				if (players.length) {
					drawList.push(`**${(players.length > 1 ? roles[role].plural : role).capitalize()} ${getUsernames(drawers[role], true).toListString()}**`);
				}
			})
			gameStateMsg += `${drawList.toListString()} ${drawList.length > 2 ? 'all ' : ''}draw!`
		}
		console.log(game);
		resetGame();
	}
	message.channel.send(gameStateMsg);
}

function postRemainingRoles(channel) {
	if (game.inProgress) {
		var remainingRoles = [];
		_.each(game.roles, (players, role) => {
			var living = players.filter(p => !p.dead);
			if (living.length) {
				remainingRoles.push(`${living.length} ${role.capitalize()}`);
			}
		})
		channel.send(`Remaining roles: ${remainingRoles.toListString()}.`);
	} else {
		channel.send(noGameErrorMsg);
	}
}

function cancelGame(channel) {
	if (game.inProgress) {
		channel.send(cancelMsg);
		resetGame()
	} else {
		channel.send(noGameErrorMsg);
	}
}

function resetGame() {
	game = { inProgress: false, loggingEnabled: true }
}

function postRulesMessage(channel, role) {
	var rulesMsg;
	if (role) { // Post a specific role's long rules
		if (roles[role]) {
			rulesMsg = `**${role.capitalize()} Rules Text**\n>>> ${roles[role].long}`;
		} else {
			rulesMsg = `Error - No role named "${role}". The roles are: ${Object.keys(roles).toListString()}.`;
		}
	} else { // Post short rules for all roles.
		rulesMsg = '**Rules Summary**\n';
		_.each(roles, (role) => { rulesMsg += ` • ${role.short}\n`; });
		rulesMsg += `\nUse \`${prefix} ${cmd.rules[0]} <role>\` to get detailed rules text for a specific role.`;
	}

	channel.send(rulesMsg);
}

function postHelpMessage(message, args) {
	var helpMsg = '';

	// Include error if invalid command triggered help response
	if (message.channel.type === 'dm' && !args.length) {
		helpMsg = `Error - A game prompt can't be started with a direct message. Please try again in a server channel.\n\n`;
	} else if (message.channel.type === 'dm' && (cmd.custom + cmd.cancel).includes(args[0])) {
		helpMsg = `Error - The \`${args[0]}\` command can't be used in a direct message. Please try again in a server channel.\n\n`;
	} else if (message.channel.type === 'dm' && message.mentions.users.size > 0) {
		helpMsg = `Error - The player logging commands can't be used in a direct message. Please try again in a server channel.\n\n`;
	} else if (cmd.custom.includes(args[0]) && args.length <= 1) {
		helpMsg = `Error - The \`${args[0]}\` command requires additional arguments.\n\n`;
	} else if (args[0] != "help") {
		helpMsg = `Error - \`${args[0]}\` is not a recognized command.\n\n`;
	}

	helpMsg += '**Bang Bot Commands**\n' + 
	`\`${prefix}\` - Post a prompt to start a game.\n` + 
	`\`${prefix} ${cmd.custom[0]} <SDORB>\` - Post a prompt to start a game with a custom role distribution. Ex: \`${prefix} ${cmd.custom[0]} SDDOOOO\` would post a prompt to start a 7-player game with a Sheriff, two Deputies, and four Outlaws. If a custom game does not have at least 1 Sheriff and at least 1 Outlaw, the player logging command will be disabled.\n` + 
	`\`${prefix} @user defeats @user2 (@user3 ... @userN)\`, \`${prefix} @user wins\`, \`${prefix} @user loses\`, \`${prefix} @user (@user2 ... @userN) draws\` - Log player(s) wins/draws/losses, reveal their roles, and process any resulting game logic. Requires a game to be in progress.\n` + 
	`\`${prefix} ${cmd.remain[0]}\` - Post which roles haven't been eliminated from the current game. Can be used in direct message to bot.\n` + 
	`\`${prefix} ${cmd.cancel[0]}\` - Cancel a game in progress.\n` + 
	`\`${prefix} ${cmd.rules[0]}\` - Post summarized role descriptions. Can be used in direct message to bot.\n` +
	`\`${prefix} ${cmd.rules[0]} <role>\` - Post full rules text for the specified role. Can be used in direct message to bot.\n` +
	`\`${prefix} ${cmd.help[0]}\` - Post bot commands. Can be used in direct message to bot.\n`;

	message.channel.send(helpMsg);
}

// HELPER FUNCTIONS

function getRolesFromArgs(roleCodes) {
	var dist = {};
	_.each(roles, (data, name) => {
		var count = roleCodes.split(data.code).length - 1;
		if (count > 0) {
			dist[name] = count;
		}
	});
	return !(_.isEmpty(dist)) ? dist : null;
}

async function getUsersWithReaction(message, emoji) {
	var players = await message.reactions.resolve(emoji).users.fetch();
	return players.filter(player => !player.bot);
}

function getUsernames(players, capitalize) {
	var usernames = [];
	players.forEach((player) => {
		usernames.push(capitalize ? player.username.capitalize() : player.username);
	});
	return usernames;
}

function getSortedMentionedUsers(message) {
	var users = [];

	message.content.split(' ').forEach((el) => {
		var user = el.match(/^<@!?(\d+)>$/);
		if (user) {
			users.push(client.users.cache.get(user[1]));
		}
	})

	return users;	
}

async function toggleBotReactionOnGamePrompt(message, emoji, toggleOn) {
	try {
		if (toggleOn) {
			message.react(emoji);
		} else if (message.reactions.cache.get(emoji)) {
			message.reactions.cache.get(emoji).users.remove(message.author.id);
		}
	} catch (error) { console.log(error); }
}

String.prototype.capitalize = function() {
	return this.charAt(0).toUpperCase() + this.slice(1);
}

Array.prototype.toListString = function() {
	var string = '';
	if (this.length > 2) {
		this.forEach((item, idx) => {
			string += (idx < this.length - 1) ? `${item}, ` : `and ${item}`
		});
	} else if (this.length === 2) {
		string = `${this[0]} and ${this[1]}`;
	} else if (this.length === 1) {
		string = `${this[0]}`;
	}
	return string;
}