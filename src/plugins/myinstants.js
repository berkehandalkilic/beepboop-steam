//@ts-check

export default class MyInstantsPlugin {
    /**
     * @param {import("../beepboop.js").default} apiGW 
     */
    constructor(apiGW){
        this.apiGW = apiGW;

        apiGW.chatHandler.addCommands({
            command: "instant",
            help: "Play an instant from myinstants",
            argsHelp: "<search>",
            handler: async (e) => {
                e.sendResponse(await this.playInstant(e.argument), false);
            }
        });

        apiGW.webApp.expressApp.post("/api/plugins/myinstants/play", async (req, res) => {
            if(req.body?.name){
                await this.playInstant(req.body.name);
            } else {
                res.status(400);
            }
            res.end();
        });

        apiGW.webApp.addBrowserScript(() => {
            window.addEventListener("load", () => {
                document.getElementById("controls")?.insertAdjacentHTML("beforeend", 
                    `<fieldset>
                        <legend>Play Instant</legend>
                        <form action="api/plugins/myinstants/play" method="post" data-asyncSubmit>
                            <small>Find and play button from <a href="https://myinstants.com" target="_blank">myinstants.com</a></small><br>
                            <input type="text" name="name">
                            <input type="submit" value="Queue">
                        </form>
                    </fieldset>`
                );
                // @ts-ignore
                registerAsyncSubmitEvents();
            });
        });
    }

    async playInstant(search){
        const instantRegEx = /^(.*?)(#(\d))?$/;
        let reRes = instantRegEx.exec(search);
        if(!reRes || reRes.length <= 1)
            throw new Error("Bad search string");
        search = reRes[1];
        let number = Number(reRes[3]) || 1;
        let url = "https://www.myinstants.com/search/?name=" + encodeURIComponent(search);
        console.log("instant search url", url);

        let response = await fetch(url);
        if(response.status != 200)
            throw new Error("Bad response status: " + response.status);

        let body = await response.text();
        
        // YENİ SİSTEM: Sesi (yolu), kendi orijinal sayfa linkini ve butondaki GERÇEK ismini HTML'den aynı anda kazar.
        let search_regex = /<button [^>]*class="[^"]*small-button[^"]*"[^>]*play\('([^']+)'[\s\S]{1,300}?<a [^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/ig;
        
        let regex_result;
        for(let i = 0; i < number; i++){
            regex_result = search_regex.exec(body);
        }
        
        if(regex_result == null){
            throw new Error("No instant found.");
        }
            
        let instantPath = regex_result[1];      // Ses dosyasının URL'si (Örn: /media/sounds/bruh.mp3)
        let instantUrl = regex_result[2];       // Sitedeki sayfa linki
        let instantName = regex_result[3].trim(); // Sitedeki orijinal Buton İsmi!

        // HTML özel karakterlerini düzelt (Örn: &amp; işaretini & harfine çevir)
        instantName = instantName.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

        // Emojili ve sitedeki GERÇEK ismiyle kuyruğa aslanlar gibi ekle
        await this.apiGW.addToQueue("https://www.myinstants.com" + instantPath, "⚡ " + instantName);
        
        // Chat tarafına (olur da Steam üstünden komut girilirse) tıklanabilir link yolla
        let fullUrl = instantUrl.startsWith("http") ? instantUrl : "https://www.myinstants.com" + instantUrl;
        return fullUrl;
    }
}