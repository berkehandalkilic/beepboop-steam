/**
 * Handles promise rejection of the function by writing the error to the console.
 * @template {(...args: any[]) => Promise<?>} T
 * @param {T} func
 * @returns {(...args: Parameters<T>) => void}
 */
function unpromisify(func) {
    return function (...args) {
        func(...args).catch(e => {
            console.error(e);
            alert(`&#9888;&#65039; Error\n${e?.message ?? e}`);
        });
    };
}

window.addEventListener("load", unpromisify(async () => {
    let authId = localStorage.getItem("authId");
    if(authId){
        let res = await fetch("api/steam/check", {
            headers: {
                Session: authId
            }
        });
        if(!res.ok){
            localStorage.removeItem("authId");
        } else {
            document.body.classList.toggle("logged", true);
            listUserSounds("welcome");
            listUserSounds("leave");
        }
    }
    listSounds();
    registerAsyncSubmitEvents();
}));

window.addEventListener("storage", (e) => {
    if(e.key == "authId"){
        if(e.newValue){
            document.body.classList.toggle("logged", true);
            document.getElementById("welcomeSounds").innerHTML = "";
            document.getElementById("leaveSounds").innerHTML = "";
            listUserSounds("welcome");
            listUserSounds("leave");
        } else {
            document.body.classList.toggle("logged", false);
        }
    }
});

function registerAsyncSubmitEvents(){
    for(let form of document.querySelectorAll("form[data-asyncSubmit]")){
        form.removeAttribute("data-asyncSubmit");
        form.addEventListener("submit", unpromisify(async (event) => {
            event.preventDefault();
            let form = event.target;

            let beforeScript = form.getAttribute("data-beforesubmit");
            if(beforeScript)
                eval(beforeScript);

            let options = {
                method: form.method
            };
            if(form.method.toUpperCase() != "GET")
                options.body = new FormData(form);
            if(form.getAttribute("data-session") != null)
                options.headers = {Session: localStorage.getItem("authId")};
            let res = await fetch(form.action, options);
            console.log(res);
            let contentType = res.headers.get("content-type");
            if(!res.ok){
                let responseText = await res.text();
                if(contentType.indexOf("text/html") !== -1 && responseText){
                    let reres = /<pre>(.*?)<br>/.exec(responseText);
                    if(reres)
                        responseText = reres[1];
                }
                if(!responseText)
                    responseText = res.statusText;
                alert(responseText);
            } else if(contentType != null && contentType.indexOf("text/javascript") !== -1){
                eval(await res.text());
            }
            
            let afterScript = form.getAttribute("data-aftersubmit");
            if(afterScript)
                eval(afterScript);
        }));
    }
}

function soundDragStart(event){
    event.dataTransfer.setData("sound", event.target.innerText);
}

function allowDrop(event){
    event.preventDefault();
}

function soundDragDrop(event, type){
    event.preventDefault();
    let sound = event.dataTransfer.getData("sound");
    addUserSound(sound, type);
}

async function listSounds(){
    try {
        let res = await fetch("api/sounds");
        let sounds = await res.json();
        if(!(sounds instanceof Array))
            throw new TypeError("Received data aren't Array.");
        let soundsElement = document.getElementById("sounds");
        for(let sound of sounds){
            let btn = document.createElement("div");
            btn.className = "button";
            btn.draggable = true;
            btn.ondragstart = soundDragStart;
            btn.innerText = sound;
            btn.addEventListener("click", unpromisify(async () => {
                let res = await fetch("api/sounds/" + encodeURIComponent(sound) + "/play", {
                    method: "POST"
                });
                console.log(res);
            }));
            soundsElement.appendChild(btn);
        }
    } catch(e){
        console.log(e);
    }
}

async function addUserSound(sound, type, sendToServer = true){
    if(sendToServer){
        let res = await fetch("api/user/sounds/"+type+"/" + sound, {
            method: "post",
            headers: {
                Session: localStorage.getItem("authId")
            }
        });
        if(res.status != 201)
            return;
    }
    let element = document.getElementById(type+"Sounds");
    let span = document.createElement("span");
    span.className = "tag";
    span.innerText = sound;
    span.innerHTML += `<button type="button" onclick="removeUserSound(this, '`+type+`')">🗙</button>`;
    element.appendChild(span);
}

async function listUserSounds(type){
    try {
        let res = await fetch("api/user/sounds/"+type+"/", {
            headers: {
                Session: localStorage.getItem("authId")
            }
        });
        let sounds = await res.json();
        for(let sound of sounds){
            addUserSound(sound, type, false);
        }
    } catch(e){
        console.log(e);
    }
}

function removeUserSound(button, type){
    let sound = button.previousSibling.textContent;
    fetch("api/user/sounds/"+type+"/" + sound, {
        method: "delete",
        headers: {
            Session: localStorage.getItem("authId")
        }
    });
    button.parentElement.parentElement.removeChild(button.parentElement);
}

function sendMessage(message) {
    return fetch("api/messages", {
        method: "post",
        headers: {
            Session: localStorage.getItem("authId")
        },
        body: message
    }).then(r => r.text());
}

// --- EKLENEN KUYRUK (QUEUE) FONKSİYONLARI ---

async function updateQueue() {
    try {
        let res = await fetch("api/queue");
        if (!res.ok) return; 

        let queueData = await res.json();
        let queueElement = document.getElementById("music-queue");
        let countElement = document.querySelector(".track-count");

        queueElement.innerHTML = ""; 
        countElement.innerText = queueData.length + (queueData.length === 1 ? " Track waiting" : " Tracks waiting");

        queueData.forEach((track, index) => {
            let li = document.createElement("li");
            li.className = "queue-item " + (track.status === 'playing' ? 'playing' : 'waiting');

            let statusHtml = track.status === 'playing' 
                ? `<span class="track-status">Now Playing</span>` 
                : '';

            let numberHtml = track.status === 'playing' ? '▶' : (index + 1) + '.';

            li.innerHTML = `
                <div class="track-info">
                    <span class="track-number">${numberHtml}</span>
                    <span class="track-title">${track.title || track.url}</span>
                </div>
                ${statusHtml}
            `;
            queueElement.appendChild(li);
        });
    } catch (e) {
        console.log("Error fetching queue (API not ready yet):", e);
    }
}

async function clearQueue() {
    if (!confirm("Are you sure you want to clear the entire music queue?")) return;

    try {
        let res = await fetch("api/queue", {
            method: "DELETE",
            headers: {
                Session: localStorage.getItem("authId")
            }
        });

        if (res.ok) {
            updateQueue(); 
        } else {
            alert("Failed to clear queue.");
        }
    } catch (e) {
        console.log("Error clearing queue:", e);
    }
}

// Sayfa yüklendiğinde kuyruk fonksiyonlarını başlat
window.addEventListener("load", () => {
    updateQueue();
    setInterval(updateQueue, 3000);
});