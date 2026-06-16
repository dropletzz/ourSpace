import { COLOR } from '../common/colors'

export function drawPersonName(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, w: number, h: number, position: 'top' | 'bottom' = 'bottom') {
    const fontSize = Math.floor(h * 0.15);
    ctx.font = `${fontSize}px Arial`;

    const nameY = position === 'bottom'
        ? y + h/2 + h*0.08
        : y - h/2 - fontSize - h*0.08
    const nameWidth = ctx.measureText(name).width;
    const padding = fontSize * 0.1;

    ctx.fillStyle = "rgba(0, 0, 0, 0.5)"; 
    ctx.fillRect(
        x - (nameWidth / 2) - padding, 
        nameY - padding, 
        nameWidth + (padding * 2), 
        fontSize + (padding * 2)
    );

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.lineWidth = 4;
    ctx.fillStyle = "#eeeeee";
    ctx.fillText(name, x, nameY);
}

export function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, spikes: number, outerRadius: number, innerRadius: number) {
    let rot = Math.PI / 2 * 3;
    let step = Math.PI / spikes;

    ctx.beginPath();
    ctx.moveTo(cx, cy - outerRadius);
    for (let i = 0; i < spikes; i++) {
        ctx.lineTo(cx + Math.cos(rot) * outerRadius, cy + Math.sin(rot) * outerRadius);
        rot += step;

        ctx.lineTo(cx + Math.cos(rot) * innerRadius, cy + Math.sin(rot) * innerRadius);
        rot += step;
    }
    ctx.lineTo(cx, cy - outerRadius);
    ctx.closePath();
    ctx.fillStyle = "#ffd700";
    ctx.fill();
}

export function drawPersonMessage(ctx: CanvasRenderingContext2D, msg: string, x: number, y: number, w: number, h: number) {
    const fontSize = Math.floor(h * 0.15);
    ctx.font = `${fontSize}px Arial`;
    const margin = h * 0.15;

    const bottomY = y - h/2 - margin;
    const msgW = w * 4;

    drawMessage(ctx, msg, fontSize, x - msgW*0.5, bottomY, msgW);
}

function drawMessage(ctx: CanvasRenderingContext2D, text: string, fontSize: number, leftX: number, bottomY: number, maxWidth: number) {
    ctx.font = `${fontSize}px Arial`;
    const padding = fontSize * 0.25;
    const lines = fitTextToWidth(ctx, text, maxWidth - padding*2);

    const lineHeight = fontSize * 1.05;
    const fullHeight = lineHeight * lines.length + padding*2;
    const topY = bottomY - fullHeight;

    ctx.fillStyle = "rgb(252, 215, 185)"; 
    ctx.fillRect(leftX, topY, maxWidth, fullHeight);

    lines.forEach((line, i) => {
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.lineWidth = 4;
        ctx.fillStyle = "#000000";
        ctx.fillText(line, leftX + padding, topY + padding + i*lineHeight);
    });

    const borderThickness = fontSize * 0.2;
    drawBorder(ctx, leftX, topY, maxWidth, fullHeight, borderThickness, COLOR.black);
}

export function drawBorder(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, thickness: number, color: string) {
    ctx.beginPath();
    ctx.rect(x - thickness, y, thickness, h);
    ctx.rect(x + w, y, thickness, h);
    ctx.rect(x, y - thickness, w, thickness);
    ctx.rect(x, y + h, w, thickness);
    ctx.fillStyle = color;
    ctx.fill();
}


// TODO fix this: it's making new lines when it should not
function fitTextToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    const words = text.split(/\s/);
    const lines: string[] = [];
    let line = "", lineW = 0;
    const spaceW = ctx.measureText(" ").width;

    while (words.length > 0) {
        const [ word ] = words.splice(0, 1);
        let wordW = ctx.measureText(word).width;
        if (wordW > maxWidth) {
            let remainingW = maxWidth - lineW;
            if (line !== "") remainingW -= spaceW;

            let chunk = "";
            for (let i=0; i < word.length; i++) {
                const newChunk = chunk + word[i];
                const newChunkW = ctx.measureText(newChunk).width;
                if (newChunkW > remainingW) break;
                chunk = newChunk;
            }

            const newLine = line + (line === "" ? "" : " ") + chunk;
            lines.push(newLine);
            line = "";
            lineW = 0;
            if (word.length > chunk.length)
                words.unshift(word.substring(chunk.length));
        }
        else {
            const newLine =  line + (line === "" ? word : " " + word);
            const newLineW = ctx.measureText(newLine).width;
            if (newLineW > maxWidth || words.length === 0) {
                if (line !== "") lines.push(line);
                line = word;
                lineW = wordW;
            }
            else {
                line = newLine;
                lineW = newLineW;
            }
        }
    }
    if (line !== "") {
        lines.push(line);
    }

    return lines;
}