(() => {
  'use strict';
  document.documentElement.dataset.prototypePage = 'input-processing';
  const $ = selector => document.querySelector(selector);
  const defaults = [
    { enabled:true, type:'Peaking', frequency:63, gain:1.5, q:1.1 },
    { enabled:true, type:'Peaking', frequency:160, gain:-1, q:.8 },
    { enabled:true, type:'Peaking', frequency:720, gain:.8, q:1.4 },
    { enabled:true, type:'Peaking', frequency:2200, gain:-.5, q:1.2 },
    { enabled:true, type:'HighShelf', frequency:7500, gain:.4, q:.7 }
  ];
  let bands = defaults.map(band => ({ ...band }));
  let inputDelay = 0;
  let analyzerFast = true;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const persist = reason => window.EStackPrototypeDSP.apply(config => {
    config.filters.ESTACK_GLOBAL_EQ = { type:'Biquad', parameters:{ channels:[0,1], bands } };
    config.inputDelayMs = inputDelay;
  }, reason);
  function draw() {
    const canvas = $('#eqCanvas');
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const ctx = canvas.getContext('2d'); const w = width / ratio; const h = height / ratio;
    ctx.setTransform(ratio,0,0,ratio,0,0); ctx.clearRect(0,0,w,h);
    const left=48,right=18,top=18,bottom=28, plotW=w-left-right,plotH=h-top-bottom;
    const xFor = freq => left + (Math.log10(freq)-Math.log10(20))/(Math.log10(20000)-Math.log10(20))*plotW;
    const yFor = db => top + (14-db)/76*plotH;
    ctx.strokeStyle='rgba(223,241,244,.14)';ctx.lineWidth=1;
    [-60,-48,-36,-24,-12,0,12].forEach(db=>{const y=yFor(db);ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(w-right,y);ctx.stroke();ctx.fillStyle='rgba(223,241,244,.62)';ctx.font='10px ui-monospace,monospace';ctx.fillText(String(db),8,y+3);});
    [20,30,50,80,100,200,500,1000,2000,5000,10000,20000].forEach(freq=>{const x=xFor(freq);ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,h-bottom);ctx.stroke();ctx.fillStyle='rgba(223,241,244,.62)';ctx.fillText(freq>=1000?`${freq/1000}k`:freq,x-8,h-8);});
    const response = freq => bands.reduce((sum,band)=>{if(!band.enabled)return sum;const distance=Math.log2(freq/band.frequency), width=1/Math.max(.25,band.q);if(band.type==='LowShelf')return sum+band.gain/(1+Math.exp(distance*4));if(band.type==='HighShelf')return sum+band.gain/(1+Math.exp(-distance*4));return sum+band.gain*Math.exp(-(distance*distance)/(width*width));},0);
    ctx.strokeStyle='#59d5e3';ctx.lineWidth=2.5;ctx.beginPath();for(let px=0;px<=plotW;px++){const freq=20*Math.pow(1000,px/plotW), y=yFor(response(freq));px?ctx.lineTo(left+px,y):ctx.moveTo(left+px,y);}ctx.stroke();
    ctx.strokeStyle='rgba(225,239,240,.46)';ctx.lineWidth=1.2;ctx.beginPath();for(let px=0;px<=plotW;px++){const freq=20*Math.pow(1000,px/plotW);const ripple=(Math.sin(px*.042)+Math.sin(px*.11)*.45)*(analyzerFast?2.8:1.3);const y=yFor(-33+response(freq)*.72+ripple-Math.max(0,Math.abs(Math.log2(freq/380))-1.7)*12);px?ctx.lineTo(left+px,y):ctx.moveTo(left+px,y);}ctx.stroke();
  }
  function renderBands() {
    $('#eqBands').innerHTML=bands.map((band,index)=>`<article class="eq-band ${band.enabled?'':'is-bypassed'}"><span class="eq-band__number">${String(index+1).padStart(2,'0')}</span><button class="band-toggle" type="button" data-toggle="${index}" aria-pressed="${band.enabled}">${band.enabled?'ON':'OFF'}</button><button class="band-delete" type="button" data-remove="${index}" aria-label="Remove band ${index+1}">×</button><label>TYPE<select class="ui-select" data-field="type" data-index="${index}"><option ${band.type==='Peaking'?'selected':''}>Peaking</option><option ${band.type==='LowShelf'?'selected':''}>LowShelf</option><option ${band.type==='HighShelf'?'selected':''}>HighShelf</option></select></label><div class="eq-band__params"><label>FREQUENCY<input class="ui-number" data-field="frequency" data-index="${index}" type="number" min="20" max="20000" value="${band.frequency}"></label><label>GAIN<input class="ui-number" data-field="gain" data-index="${index}" type="number" min="-18" max="18" step=".1" value="${band.gain}"></label><label>Q<input class="ui-number" data-field="q" data-index="${index}" type="number" min=".25" max="18" step=".1" value="${band.q}"></label></div></article>`).join('');
    document.querySelectorAll('[data-toggle]').forEach(button=>button.addEventListener('click',()=>{const index=Number(button.dataset.toggle);bands[index].enabled=!bands[index].enabled;persist('input EQ band');render();}));
    document.querySelectorAll('[data-remove]').forEach(button=>button.addEventListener('click',()=>{bands.splice(Number(button.dataset.remove),1);persist('remove input EQ band');render();}));
    document.querySelectorAll('[data-field]').forEach(control=>control.addEventListener('change',()=>{const band=bands[Number(control.dataset.index)], field=control.dataset.field;band[field]=field==='type'?control.value:Number(control.value);persist('input EQ adjustment');draw();}));
  }
  function renderDelay() { $('#delayRange').value=inputDelay;$('#delayNumber').value=inputDelay;$('#delayReadout').textContent=`${inputDelay.toFixed(1)} ms`;const active=inputDelay>0;$('#delayState').textContent=active?'ACTIVE':'BYPASS';$('#delayState').className=`ui-badge ${active?'is-success':'is-bypassed'}`; }
  function render(){renderBands();renderDelay();draw();}
  $('#addBand').addEventListener('click',()=>{if(bands.length>=10)return;bands.push({enabled:true,type:'Peaking',frequency:1000,gain:0,q:1});persist('add input EQ band');render();});
  $('#eqReset').addEventListener('click',()=>{bands=defaults.map(band=>({...band}));persist('reset input EQ');render();});
  $('#analyzerSpeed').addEventListener('click',event=>{analyzerFast=!analyzerFast;event.currentTarget.textContent=analyzerFast?'FAST':'SLOW';event.currentTarget.classList.toggle('is-active',analyzerFast);draw();});
  const setDelay=(value,reason)=>{inputDelay=clamp(Number(value)||0,0,2000);persist(reason);renderDelay();};
  $('#delayRange').addEventListener('input',event=>setDelay(event.target.value,'input delay'));
  $('#delayNumber').addEventListener('change',event=>setDelay(event.target.value,'input delay'));
  $('#delayReset').addEventListener('click',()=>setDelay(0,'reset input delay'));
  document.querySelectorAll('[data-nudge]').forEach(button=>button.addEventListener('click',()=>setDelay(inputDelay+Number(button.dataset.nudge),'input delay nudge')));
  window.addEventListener('resize',draw);
  let inputStateHydrated=false;
  window.EStackPrototypeDSP.subscribe((config,reason)=>{
    $('#inputState').textContent=config.connected?'CAMILLADSP READY':'LOCAL SIMULATION';
    if (!inputStateHydrated || reason==='initial shell state') {
      const storedBands=config.filters?.ESTACK_GLOBAL_EQ?.parameters?.bands;
      if (Array.isArray(storedBands) && storedBands.length) bands=storedBands.map(band=>({...band}));
      inputDelay=clamp(Number(config.inputDelayMs)||0,0,2000);
      inputStateHydrated=true;
      render();
    }
  });
  render();
})();
