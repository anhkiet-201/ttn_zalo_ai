import {
  type BotCommand,
  type CommandContext,
  type ParsedMessage,
} from "../types/zalo.types.js";
import { type ZaloService } from "../services/zaloService.js";
import { config } from "../config/index.js";

/**
 * CommandHandler: Quản lý danh sách các lệnh của Bot và thực thi khi có yêu cầu
 */
export class CommandHandler {
  private commands: Map<string, BotCommand> = new Map();
  private aliases: Map<string, string> = new Map();
  private startTime: number = Date.now();

  constructor(private readonly zaloService: ZaloService) {
    this.registerDefaultCommands();
  }

  /**
   * Đăng ký một lệnh mới vào hệ thống
   */
  public register(command: BotCommand): void {
    const cmdName = command.name.toLowerCase();
    this.commands.set(cmdName, command);

    if (command.aliases) {
      for (const alias of command.aliases) {
        this.aliases.set(alias.toLowerCase(), cmdName);
      }
    }
  }

  /**
   * Xử lý thực thi lệnh từ tin nhắn đã phân tích
   */
  public async handle(parsedMessage: ParsedMessage): Promise<boolean> {
    if (!parsedMessage.command) {
      return false;
    }

    const commandName = parsedMessage.command;
    const actualName = this.aliases.get(commandName) || commandName;
    const command = this.commands.get(actualName);

    if (!command) {
      return false;
    }

    const reply = async (text: string) => {
      return this.zaloService.replyMessage(parsedMessage.raw, text);
    };

    const ctx: CommandContext = {
      parsedMessage,
      reply,
      api: this.zaloService.rawApi,
    };

    try {
      await command.execute(ctx);
      return true;
    } catch (error) {
      console.error(`❌ Lỗi khi thực thi lệnh /${commandName}:`, error);
      await reply(`⚠️ Đã xảy ra lỗi khi thực thi lệnh /${commandName}.`);
      return true;
    }
  }

  /**
   * Đăng ký các lệnh mặc định hữu ích
   */
  private registerDefaultCommands(): void {
    // 1. Lệnh /ping
    this.register({
      name: "ping",
      aliases: ["p"],
      description: "Kiểm tra độ phản hồi của Bot",
      usage: `${config.botPrefix}ping`,
      execute: async ({ reply, parsedMessage }) => {
        const latency = Date.now() - parsedMessage.timestamp;
        const latencyStr = latency >= 0 ? `${latency}ms` : "Ngay tức thì";
        await reply(`🏓 Pong!\n⚡ Độ trễ nhận tin: ${latencyStr}\n🟢 Bot đang hoạt động bình thường!`);
      },
    });

    // 2. Lệnh /help
    this.register({
      name: "help",
      aliases: ["h", "menu"],
      description: "Hiển thị danh sách các câu lệnh có sẵn",
      usage: `${config.botPrefix}help`,
      execute: async ({ reply }) => {
        let helpText = "🤖 DANH SÁCH CÁC LỆNH BOT:\n\n";
        const seen = new Set<string>();

        for (const [name, cmd] of this.commands.entries()) {
          if (seen.has(name)) continue;
          seen.add(name);

          const aliasStr =
            cmd.aliases && cmd.aliases.length > 0
              ? ` (viết tắt: ${cmd.aliases.map((a) => `${config.botPrefix}${a}`).join(", ")})`
              : "";

          helpText += `👉 ${config.botPrefix}${cmd.name}${aliasStr}\n   📝 ${cmd.description}\n`;
        }

        helpText += `\n💡 Prefix hiện tại của bot là: "${config.botPrefix}"`;
        await reply(helpText);
      },
    });

    // 3. Lệnh /echo
    this.register({
      name: "echo",
      description: "Lặp lại nội dung bạn vừa nhập",
      usage: `${config.botPrefix}echo <nội dung>`,
      execute: async ({ reply, parsedMessage }) => {
        const textToEcho = parsedMessage.args.join(" ").trim();
        if (!textToEcho) {
          await reply(`⚠️ Vui lòng nhập nội dung cần lặp lại. Ví dụ: ${config.botPrefix}echo Xin chào!`);
          return;
        }
        await reply(`🔊 ${textToEcho}`);
      },
    });

    // 4. Lệnh /info
    this.register({
      name: "info",
      aliases: ["bot", "about"],
      description: "Hiển thị thông tin về Bot và hệ thống",
      usage: `${config.botPrefix}info`,
      execute: async ({ reply }) => {
        const ownId = this.zaloService.getOwnId();
        const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);
        const hours = Math.floor(uptimeSeconds / 3600);
        const minutes = Math.floor((uptimeSeconds % 3600) / 60);
        const seconds = uptimeSeconds % 60;

        const infoText =
          `🤖 THÔNG TIN ZALO BOT:\n` +
          `━━━━━━━━━━━━━━━━━━━\n` +
          `🆔 Bot ID: ${ownId}\n` +
          `⏱️ Thời gian hoạt động: ${hours}h ${minutes}m ${seconds}s\n` +
          `📦 Nền tảng: zca-js (Unofficial Zalo API) + TypeScript\n` +
          `⚡ Prefix lệnh: ${config.botPrefix}\n` +
          `━━━━━━━━━━━━━━━━━━━`;
        await reply(infoText);
      },
    });
  }
}
