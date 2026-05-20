//@ts-check
import { ytHelper } from "../yt-helper.js";

export default class SteamChatAudio {
    /**
     * @param {import("../beepboop.js").default} beepBoop
     * @param {string} soundsBaseUrl
     */
    constructor(beepBoop, soundsBaseUrl) {
        this.bb = beepBoop;
        this.soundsBaseUrl = soundsBaseUrl;
    }

    get frame(){
        let f = this.bb.chatFrame;
        if(!f)
            throw new Error("FriendsUi frame is not available.");
        return f;
    }

    async init(volume = 0.3) {
        let g_FriendsUIApp; 
        
        try {
            await this.bb.chatPage.exposeFunction('onAudioEnded', () => {
                console.log("Track ended. Playing next in queue...");
                if (this.bb.musicQueue && this.bb.musicQueue.length > 0) {
                    let finishedTrack = this.bb.musicQueue.shift(); 
                    this.bb.historyQueue.push(finishedTrack);
                    
                    if (this.bb.historyQueue.length > 50) this.bb.historyQueue.shift();

                    this.bb.playNextInQueue();  
                } else {
                    this.bb.isPlaying = false; 
                }
            });
        } catch (e) { }

        await this.frame.evaluate((volume_) => {
            g_FriendsUIApp.VoiceStore.SetUseEchoCancellation(false);
            g_FriendsUIApp.VoiceStore.SetUseAutoGainControl(true);
            g_FriendsUIApp.VoiceStore.SetUseNoiseCancellation(false);
            g_FriendsUIApp.VoiceStore.SetUseNoiseGateLevel(0);

            // Fake microphone setup
            let fakeAudio = {
                audioContext: new AudioContext(),
                audio: new Audio(),
                currentSource: null // Eski ses düğümünü hafızada tutmak için
            };
            fakeAudio.gainNode = fakeAudio.audioContext.createGain();
            fakeAudio.gainNode.gain.value = volume_;

            fakeAudio.addStream = function(stream){
                // Eski ses akışı kablosunu sökerek hafıza sızıntısını (stuttering) önler
                if (fakeAudio.currentSource) {
                    fakeAudio.currentSource.disconnect();
                }
                
                fakeAudio.currentSource = fakeAudio.audioContext.createMediaStreamSource(stream);
                fakeAudio.currentSource.connect(fakeAudio.gainNode);
            }

            fakeAudio.getUserMedia = function(_options, success){
                let mixed = fakeAudio.audioContext.createMediaStreamDestination();
                fakeAudio.gainNode.connect(mixed);
                success(mixed.stream);
            }

            fakeAudio.audio = new Audio();
            fakeAudio.audio.controls = true;
            fakeAudio.audio.crossOrigin = "annonymous";
            
            fakeAudio.audio.onended = () => {
                if (window.onAudioEnded) window.onAudioEnded();
            };

            fakeAudio.audio.oncanplay = ()=>{
                //@ts-ignore
                fakeAudio.addStream(fakeAudio.audio.captureStream());
                fakeAudio.audio.play();
            };

            //@ts-ignore
            navigator.getUserMedia = fakeAudio.getUserMedia;
            //@ts-ignore
            navigator.mediaDevices.getUserMedia = fakeAudio.getUserMedia;

            //@ts-ignore
            window.fakeAudio = fakeAudio;
        }, volume);
    }

    async playSound(soundName){
        await this.playSoundUrl(`${this.soundsBaseUrl}/api/sounds/${soundName}`);
    }
    
    /**
     * @param {string} url 
     * @param {boolean} checkYt 
     */
    async playSoundUrl(url, checkYt = true){
        console.log("Play sound", url);
        let yt = checkYt && ytHelper.validateUrl(url);

        if(yt) {
            url = `${this.soundsBaseUrl}/api/ytdl/${encodeURIComponent(url)}`;
        } else if(!url.startsWith(this.soundsBaseUrl)) {
            url = `${this.soundsBaseUrl}/api/proxy/${encodeURIComponent(url)}`;
        }

        /** @type {{audioContext: AudioContext; audio: HTMLAudioElement;}} */
        let fakeAudio;
        try {
            await this.frame.evaluate(async (url) => {
                await /** @type {Promise<void>} */(new Promise((resolve, reject) => {
                    let errorHandler = async () => {
                        fakeAudio.audio.removeEventListener("error", errorHandler);
                        fakeAudio.audio.removeEventListener("canplay", canplayHandler);
                        try {
                            await fakeAudio.audio.play();
                        } catch(exception){
                            return reject(new Error(`${exception.message} Code ${fakeAudio.audio.error.code}: ${fakeAudio.audio.error.message}`));
                        }
                        reject(new Error("Error while loading audio from URL."));
                    };
                    let canplayHandler = () => {
                        fakeAudio.audio.removeEventListener("error", errorHandler);
                        fakeAudio.audio.removeEventListener("canplay", canplayHandler);
                        resolve();
                    };
                    fakeAudio.audio.addEventListener("error", errorHandler);
                    fakeAudio.audio.addEventListener("canplay", canplayHandler);
                    fakeAudio.audio.src = url;
                }));
            }, url);
        } catch(e){
            if(yt) {
                let res = await fetch(url);
                console.log(res.status, res.statusText);
            }
            if(e.message)
                throw new Error(e.message.replace("Evaluation failed: ", ""));
            throw e;
        }
    }

    resumeSound(){
        //@ts-ignore
        return this.frame.evaluate(() => fakeAudio.audio.play());
    }

    stopSound(){
        //@ts-ignore
        return this.frame.evaluate(() => fakeAudio.audio.pause());
    }

    async textToSpeech(text){
        if(this.bb.config.ttsUrl){
            text = text.replace("/me", this.bb.steamChat.myName);
            // TTS seslerini de sıraya emojili ve korumalı şekilde ekler
            await this.bb.addToQueue(this.bb.config.ttsUrl + encodeURIComponent(text), "💬 " + text);
        }
    }
}