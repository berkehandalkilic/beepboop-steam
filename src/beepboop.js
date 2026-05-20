//@ts-check
import pgPromise from "pg-promise";
import requireFromString from "require-from-string";
import config from "./config-loader.js";
import SoundsDbGw from "./sounds-db-gw.js";
import SteamBrowserApi from "./steam-api/steam-browser-api.js";
import SteamChatApi from "./steam-api/steam-chat-api.js";
import SteamChatAudio from "./steam-api/steam-chat-audio.js";
import SteamClientApi from "./steam-api/steam-client-api.js";
import { getStorage, setUpPersistence } from "./storage.js";
import * as utils from "./utils.js";
import WebApp from "./webapp.js";
import SteamFriendsUiApi from "./steam-api/steam-friends-ui-api.js";
///<reference path="./types.d.ts" />

const paddedVer = (config?.version || "?").padEnd(13).substring(0, 13);
const startMessage = 
`
 ___               ___                
| _ ) ___ ___ _ __| _ ) ___  ___ _ __ 
| _ V/ -_) -_) '_ V _ V/ _ V/ _ V '_ V
|___/V___V___| .__/___/V___/V___/ .__/
             |_| v${paddedVer } |_|  `
    //@ts-ignore
    .replaceAll("V", "\\");

export default class BeepBoop {
    constructor(){
        this.musicQueue = [];
        this.historyQueue = []; 
        this.isPlaying = false;

        /** @type {Config} */
        this.config = config;
        this.webApp = new WebApp(config.baseUrl, config.port);
        if(config.db?.connection){
            this.db = pgPromise()(config.db.connection);
            this.soundsDbGw = new SoundsDbGw(this.db);
        }
        switch(config.mode){
            case "client":
                this.steamClient = new SteamClientApi();
                break;
                case "web":
                this.steamBrowser = new SteamBrowserApi(this);
                break;
            default:
                throw new Error("No mode selected.");
        }
        this.steamChat = new SteamChatApi(this);
        this.steamChatAudio = new SteamChatAudio(this, "http://localhost:" + config.port);
        this.plugins = [];
    }

    async addToQueue(url, providedTitle = null) {
        let title = providedTitle;

        if (!title) {
            if (url.includes("youtube.com") || url.includes("youtu.be")) {
                try {
                    let res = await utils.request(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
                    let data = JSON.parse(res.body.toString());
                    title = "▶ " + data.title;
                } catch(e) {
                    let videoId = url.split("v=")[1]?.substring(0, 11) || "YouTube Video";
                    title = "▶ YouTube: " + videoId;
                }
            } else if (url.includes("myinstants.com")) {
                let parts = url.split("/").filter(p => p);
                title = "⚡ " + (parts[parts.length - 1]).replace(/-/g, ' ');
            } else if (url.includes("/api/sounds/")) {
                let parts = url.split("/");
                title = "🔊 " + decodeURIComponent(parts[parts.length - 1]);
            } else {
                title = "🎵 URL Track";
            }
        }

        this.musicQueue.push({ url: url, title: title, status: 'waiting' });
        
        if (!this.isPlaying) {
            this.playNextInQueue();
        }
    }

    async playNextInQueue() {
        if (this.musicQueue.length === 0) {
            this.isPlaying = false;
            // CRITICAL BUG FIX: Son şarkı geçildiğinde ve sırada şarkı kalmadığında çalmaya devam eden sesi zorla susturuyoruz.
            await this.steamChatAudio.stopSound().catch(console.error);
            return;
        }

        this.isPlaying = true;
        let nextTrack = this.musicQueue[0];
        nextTrack.status = 'playing';

        try {
            await this.steamChatAudio.playSoundUrl(nextTrack.url);
        } catch(e) {
            console.error("Şarkı çalınamadı, atlanıyor:", e);
            this.musicQueue.shift();
            this.playNextInQueue();
        }
    }

    async init(){
        console.info(startMessage);
        await this.soundsDbGw?.init();
        setUpPersistence(this.db).catch(console.error);
        console.info(`Initializing Steam ${config.mode} API.`);
        await this.steamClient?.init();
        await this.steamBrowser?.init()
        
        await this.onChatLoaded();

        console.info("Initializing REST API.");
        this.webApp.startRestApi(this);
        this.webApp.startSteamLoginApi();
        await this.loadPlugins();
        console.info(`BeepBoop started in ${process.uptime()} seconds.`);

        // 👇👇👇 ZARİF KAPANIŞ (GRACEFUL SHUTDOWN) 👇👇👇
        const exitHandler = async (signal) => {
            console.log(`\n[${signal}] Kapatma sinyali alındı! Chrome ve Steam bağlantıları güvenli bir şekilde sonlandırılıyor...`);
            try {
                this.isPlaying = false; // Kuyruk sistemini durdurur
                await this.stop(); // Chrome'u ve sekmeleri resmi olarak kapatır
                console.log("Kapanış işlemleri tamamlandı. Hesaptan çıkıldı, hoşça kal!");
                process.exit(0);
            } catch (e) {
                console.error("Kapatılırken hata oluştu:", e);
                process.exit(1);
            }
        };

        process.on('SIGINT', () => exitHandler('SIGINT'));   // Terminalde Ctrl+C yapıldığında
        process.on('SIGTERM', () => exitHandler('SIGTERM')); // docker-compose down yapıldığında
        // 👆👆👆 ZARİF KAPANIŞ BİTTİ 👆👆👆

        this.chatPage.on("load", async () => {
            if(await this.chatFrame.evaluate(SteamFriendsUiApi.isSteamChat)){
                setTimeout(() => this.onChatLoaded().catch(console.error), 2000);
            }
        });
    }

    async onChatLoaded(){
        console.info("Steam Chat yükleniyor, arayüzün (g_FriendsUIApp) gelmesi için 10 saniye bekleniyor...");
        await new Promise(resolve => setTimeout(resolve, 10000));
        console.info("Initializing Steam chat API.");
        
        try {
            await this.steamChat.init();
            console.log("Initializing Steam chat audio.");
            await this.steamChatAudio.init(config.volume);

            if(config.steam?.groupName && config.steam?.channelName){
                await this.steamChat.joinVoiceChannel(config.steam.groupName, config.steam.channelName, true);
                console.info(`Successully joined voice channel ${config.steam?.channelName} in ${config.steam?.groupName}`);
            } else {
                console.warn("Missing steam.groupName or steam.channelName, got nowhere to join.");
            }
        } catch (error) {
            console.error("Steam kanala bağlanırken hata oluştu:", error);
        }
    }

    async stop(){
        await this.steamChat.leaveVoiceChannel();
        await this.steamBrowser?.browser.close();
    }

    get chatFrame(){
        //@ts-ignore
        return this.steamClient?.getFriendsUiFrame() || this.steamBrowser?.getFriendsUiFrame();
    }

    get chatPage(){
        //@ts-ignore
        return this.steamClient?.getFriendsUiPage() || this.steamBrowser?.getFriendsUiPage();
    }

    get chatHandler(){
        return this.steamChat.chatHandler;
    }

    async loadPlugins(){
        if(!config.plugins)
            return;
        for(let plugin of config.plugins){
            console.log("Loading \""+plugin+"\" plugin.");
            try {
                let pluginClass;
                if(plugin.startsWith("http:") || plugin.startsWith("https:")){
                    let code = (await utils.request(plugin)).body.toString();
                    pluginClass = requireFromString(code, "./plugins/"+plugin.replace(/[^\w^.]+/g, "_"));
                } else {
                    pluginClass = await import("./plugins/"+plugin+".js");
                }
                if(typeof pluginClass !== "function" && pluginClass.default)
                    pluginClass = pluginClass.default;
                this.plugins.push(new (pluginClass)(this, await getStorage(plugin)));
            } catch(error){
                console.error(error);
            }
        }
    }
}