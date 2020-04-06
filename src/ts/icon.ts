function draw(len: number) {
    let canvas = <HTMLCanvasElement>document.getElementById('canvas');
    if (!canvas) return;
    let context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (len > 24) context.fillStyle = 'rgba(211,2,5,255)';
    else context.fillStyle = 'rgba(0,0,0,255)';
    context.font = 'bold 15px Arial';
    context.fillText(len.toString(), len > 10 ? 0 : 5, canvas.height / 2 + 5);
    return context.getImageData(0, 0, 19, 19);
}

function setIcon() {
    chrome.tabs.query({}, function (tabs) {
        chrome.browserAction.setIcon({
            imageData: draw(tabs.length),
        });
    });
}

export default function iconListener() {
    // Called when the user clicks on the page action.
    chrome.tabs.onActivated.addListener(setIcon);
    setIcon();
}
