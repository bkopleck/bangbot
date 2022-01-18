const { SlashCommandBuilder } = require('@discordjs/builders');
const { ChannelType } = require('discord-api-types/v9');
const cfg = require('./../config.json');
const tkn = require('./../tokens.json');
const _ = require('underscore');

const hundredCowboyMsg = 'STOP! You have been visited by **The :100: Sheriff**\n\n                  :cowboy:\n            :100::100::100:\n      :100:      :100:      :100:\n:point_down:         :100::100:         :point_down:\n          :100:          :100:\n          :100:          :100:\n           :boot:          :boot:\n\nClutch topdecks and perfect mana will come to you, but only if you comment "yeehaw" in the thread.';

module.exports = {
	data: new SlashCommandBuilder()
		.setName('bang')
		.setDescription('Commands related to Bang!')
		.addSubcommand(subcommand =>
			subcommand
				.setName('game')
				.setDescription('Start a game')
				.addChannelOption(option =>
					option.setName('channel')
						.setDescription('The channel to start a game for')
						.setRequired(true)
						.addChannelType(ChannelType.GuildVoice)
				)
		)
		.addSubcommand(subcommand =>
			subcommand
				.setName('rules')
				.setDescription('Post rules')
				.addStringOption(option =>
					option.setName('role')
						.setDescription('Post rules for role')
						.addChoice('Sheriff', 'sheriff')	
						.addChoice('Deputy', 'deputy')	
						.addChoice('Outlaw', 'outlaw')	
						.addChoice('Renegade', 'renegade')	
						.addChoice('Beggar', 'beggar')
				)
		)
		.addSubcommand(subcommand =>
			subcommand
				.setName('bless')
				.setDescription('#bless')
		),
	async execute(interaction, client) {
		if (!interaction.isCommand() && interaction.commandName != 'bang') return;

		if (interaction.options._subcommand === 'game') {
			var members = interaction.options._hoistedOptions[0].channel.members;
			const roledist = cfg.roledists[members.size];
			if (roledist) {
				var roleList = [];
				var roleStrs = [];
				var sheriff;

				_.each(roledist, (count, role) => {
					for (var i = 0; i < count; i++) {
						roleList.push(role);
						if (count > 0) {
							roleStrs.push(
								`${count} ` + (count > 1 ? cfg.roles[role].plural : role).capitalize()
							);
						}
					}
				});
				roleList = _.shuffle(roleList);

				members.forEach((data, id) => {
					const role = roleList.shift();
					if (role === 'sheriff') { sheriff = data.user}

					client.users.fetch(id).then((user) => {
						user.send(roleMessage(role));
					});
				});

				await interaction.reply(gameStartMessage(roleStrs, sheriff));
			} else {
				await interaction.reply("incorrect number of players (supports 6-8 players)");
			}
		} else if (interaction.options._subcommand === 'rules') {
			role = interaction.options._hoistedOptions[0].value;
			await interaction.reply(ruleMessage(role));
		} else if (interaction.options._subcommand === 'bless') {
			await interaction.reply(hundredCowboyMsg);
		}
	},
};

function roleMessage(role) {
	return `Howdy! Your role is **${role.capitalize()}**.\n` + 
	`${cfg.roles[role].short}\n\n` + 
	`Use \`/bang rules ${role}\` to get the detailed rules text for this role.`
}

function gameStartMessage(roleStrs, sheriff) {
	var msg =  `Roles have been assigned! This game has ${roleStrs.toListString()}.\n`;
	if (tkn.danId && sheriff.id === tkn.danId) {
		msg += `${sheriff} will be your Begg- sorry, I mean _Sheriff_ this game. Good luck, y'all!`;
	} else {
		msg += `${sheriff} will be your Sheriff this game. Good luck, y'all!`;
	}
	return msg;
}

function ruleMessage(role) {
	var rulesMsg;
	if (role) { // Post a specific role's long rules
		rulesMsg = `**${role.capitalize()} Rules Text**\n>>> ${cfg.roles[role].long}`;
	} else { // Post short rules for all roles.
		rulesMsg = '**Rules Summary**\n';
		_.each(cfg.roles, (role) => { rulesMsg += ` • ${role.short}\n`; });
		rulesMsg += `\nUse \`/bang rules <role>\` to get detailed rules text for a specific role.`;
	}
	return rulesMsg;
}

// UTILITY FUNCTIONS

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