// Personal presentation over a shared movie. The media clock and outcome never change.
export class BattleImpact {
  constructor(video, scene, flash, motion) {
    Object.assign(this, { video, scene, flash, motion });
    this.canvas = document.createElement('canvas'); this.canvas.className = 'battle-impact';
    this.canvas.setAttribute('aria-hidden', 'true'); scene.insertBefore(this.canvas, scene.querySelector('.battle-overlay'));
    this.ctx = this.canvas.getContext('2d'); this.snapshot = document.createElement('canvas'); this.shot = this.snapshot.getContext('2d');
    this.activeFrame = -1; this.audioCount = 0; this.captureCount = 0; this.sources = new Set();
    for (const name of ['pause', 'waiting', 'seeking', 'emptied']) video.addEventListener(name, () => this.stopAudio());
    video.addEventListener('volumechange', () => { if (this.gain) this.gain.gain.value = video.muted ? 0 : video.volume * .8; });
  }
  unlockAudio() {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    if (!this.audio) {
      this.audio = new AC(); this.gain = this.audio.createGain();
      const limiter = this.audio.createDynamicsCompressor(); limiter.threshold.value = -10; limiter.ratio.value = 8;
      this.gain.connect(limiter); limiter.connect(this.audio.destination);
      const rate = this.audio.sampleRate, buffer = this.audio.createBuffer(1, Math.ceil(rate * .56), rate), data = buffer.getChannelData(0);
      let phase = 0, filtered = 0, seed = 7823, peak = .01;
      for (let i=0; i<data.length; i++) {
        const t=i/rate; seed=(Math.imul(seed,1664525)+1013904223)>>>0;
        const noise=seed/4294967296*2-1; filtered+=.1*(noise-filtered); phase+=2*Math.PI*(48+95*Math.exp(-t*34))/rate;
        data[i]=(Math.sin(phase)*Math.exp(-t*12)*.72+(noise-filtered)*Math.exp(-t*65)*.48+filtered*Math.exp(-t*9)*.7+Math.sin(2*Math.PI*830*t)*Math.exp(-t*25)*.07)*Math.min(1,t/.003)*Math.min(1,(.56-t)/.035);
        peak=Math.max(peak,Math.abs(data[i]));
      }
      for (let i=0;i<data.length;i++) data[i]*=.78/peak;
      this.buffer=buffer;
    }
    this.audio.resume().catch(()=>{});
  }
  trigger(frame, point) {
    if (this.activeFrame===frame) return;
    this.activeFrame=frame; this.point=point;
    const scale=Math.min(1,960/this.video.videoWidth); this.snapshot.width=Math.round(this.video.videoWidth*scale); this.snapshot.height=Math.round(this.video.videoHeight*scale);
    try { this.shot.drawImage(this.video,0,0,this.snapshot.width,this.snapshot.height); this.captureCount++; } catch { this.activeFrame=-1; }
    if (this.audio?.state==='running' && !this.video.muted && !this.video.paused) {
      this.gain.gain.value=this.video.volume*.8;
      const source=this.audio.createBufferSource(); source.buffer=this.buffer; source.connect(this.gain); this.sources.add(source);
      source.onended=()=>{this.sources.delete(source);source.disconnect();}; source.start(); this.audioCount++;
    }
    this.canvas.dataset.captures=String(this.captureCount); this.canvas.dataset.audioCount=String(this.audioCount);
  }
  stopAudio() { for (const s of this.sources) { try {s.stop();} catch {} } this.sources.clear(); }
  clear() { this.activeFrame=-1; this.scene.style.transform=''; this.flash.style.opacity='0'; this.canvas.hidden=true; this.stopAudio(); }
  present(event, age, bounds, allowed) {
    const active=allowed && event && event.frame===this.activeFrame && age>=0 && age<.85 && !this.motion.matches;
    this.canvas.hidden=!active;
    if (!active) {this.scene.style.transform='';this.flash.style.opacity='0';return false;}
    const w=this.scene.clientWidth,h=this.scene.clientHeight,dpr=Math.min(1.5,window.devicePixelRatio||1);
    if(this.canvas.width!==Math.round(w*dpr)||this.canvas.height!==Math.round(h*dpr)){this.canvas.width=Math.round(w*dpr);this.canvas.height=Math.round(h*dpr);}
    const c=this.ctx; c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);
    const p=age/.85, strength=Math.min(1,age/.025)*Math.pow(1-p,2), direction=this.point.x<.5?-1:1;
    const x=direction*w*(.014*strength+.012*Math.sin(age*108)*strength),y=w*.014*Math.cos(age*83)*strength;
    const roll=direction*1.1*Math.sin(age*36)*strength;
    this.scene.style.transform=`translate(${x}px,${y}px) scale(${1+.11*strength}) rotate(${roll}deg)`;
    this.flash.style.opacity=String(.32*Math.min(1,age/.018)*Math.exp(-age*22));
    const cx=bounds.x+this.point.x*bounds.width,cy=bounds.y+this.point.y*bounds.height;
    c.save();c.beginPath();c.rect(bounds.x,bounds.y,bounds.width,bounds.height);c.clip();
    // A captured movie frame supplies radial echoes; no per-frame video decoding or readback.
    c.globalCompositeOperation='screen';c.filter=this.video.classList.contains('wager-eliminated')?'grayscale(.88)':'saturate(1.2)';
    for(let i=1;i<=6;i++){
      const z=1+i*.026*strength;c.globalAlpha=.09*strength*(1-i/9);
      c.drawImage(this.snapshot,cx+(bounds.x-cx)*z,cy+(bounds.y-cy)*z,bounds.width*z,bounds.height*z);
    }
    // Brief displaced target-area echo reinforces the strike while leaving HUD text sharp.
    if(age<.32){
      c.save();c.beginPath();c.ellipse(cx,cy,bounds.width*.14,bounds.height*.12,0,0,Math.PI*2);c.clip();c.globalAlpha=.28*strength;
      c.drawImage(this.snapshot,bounds.x+direction*12*strength,bounds.y-6*strength,bounds.width,bounds.height);c.restore();
    }
    c.filter='none';c.globalAlpha=1;c.globalCompositeOperation='source-over';
    const edge=c.createRadialGradient(cx,cy,w*.12,cx,cy,w*.8);edge.addColorStop(0,'transparent');edge.addColorStop(1,`rgba(0,5,12,${.48*strength})`);c.fillStyle=edge;c.fillRect(bounds.x,bounds.y,bounds.width,bounds.height);
    if(age<.25){
      const radius=w*(.06+age*.65);c.lineWidth=2*(1-age/.25);c.strokeStyle=`rgba(255,219,140,${.6*strength})`;
      c.beginPath();c.ellipse(cx,cy,radius,radius*.55,-.25,0,Math.PI*2);c.stroke();
      for(let i=0;i<16;i++){const a=i*Math.PI/8+.15,r=radius*(1.1+(i%3)*.17);c.beginPath();c.moveTo(cx+Math.cos(a)*r,cy+Math.sin(a)*r*.7);c.lineTo(cx+Math.cos(a)*(r+w*.06*strength),cy+Math.sin(a)*(r+w*.06*strength)*.7);c.stroke();}
    }
    c.restore();this.canvas.dataset.strength=String(strength);return true;
  }
}
