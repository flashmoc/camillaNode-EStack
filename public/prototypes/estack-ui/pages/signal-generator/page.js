(() => {
  'use strict';
  document.documentElement.dataset.prototypePage = 'signal-generator';
  const $ = selector => document.querySelector(selector);
  const ways = [['SUB',1],['KICK',2],['MID L',3],['MID R',4],['HIGH L',5],['HIGH R',6]];
  const quick = [40,50,60,80,100,130,300,1000,2000,4000,10000];
  let targets = [0], active = false, deadline = 0, timer;
  const selectedCap = () => { const white=$('#signalType').value==='WhiteNoise'; if(targets.some(index=>index>=4))return white?-30:-20;if(targets.some(index=>index>=2))return white?-25:-15;return white?-20:-10; };
  const render = () => {
    const white=$('#signalType').value==='WhiteNoise'; const cap=selectedCap();
    $('#frequencyField').hidden=white;$('#quickBlock').hidden=white;$('#level').max=String(cap);if(Number($('#level').value)>cap)$('#level').value=String(cap);
    $('#levelReadout').textContent=`${Number($('#level').value).toFixed(0).replace('-', '−')} dBFS`;
    $('#safetyNote').textContent=`Safety ceiling ${cap} dBFS · start around −40 dBFS`;
    $('#targets').innerHTML=ways.map(([name,out],index)=>`<button class="target ${targets.includes(index)?'is-active':''}" type="button" data-target="${index}" ${active?'disabled':''}><strong>${name}</strong><span>OUT ${out}</span></button>`).join('');
    $('#frequencies').innerHTML=quick.map(freq=>`<button type="button" data-frequency="${freq}" ${active?'disabled':''}>${freq>=1000?`${freq/1000}k`:freq}</button>`).join('');
    document.querySelectorAll('[data-target]').forEach(button=>button.addEventListener('click',()=>{const index=Number(button.dataset.target);targets=targets.includes(index)?targets.filter(item=>item!==index):[...targets,index];if(!targets.length)targets=[index];render();}));
    document.querySelectorAll('[data-frequency]').forEach(button=>button.addEventListener('click',()=>{$('#frequency').value=button.dataset.frequency;}));
    $('#startSignal').disabled=active;$('#stopSignal').disabled=!active;$('#signalType').disabled=active;$('#frequency').disabled=active;$('#level').disabled=active;$('#duration').disabled=active;
    $('#signalState').textContent=active?'TEST ACTIVE':'NORMAL INPUT';$('#signalState').className=`ui-status ${active?'is-warning':'is-success'}`;
  };
  const tick = () => { const seconds=Math.max(0,Math.ceil((deadline-Date.now())/1000));$('#signalCountdown').textContent=active?`${seconds} S REMAINING`:'STANDBY';if(active&&seconds===0)stop('auto stop'); };
  const start = () => { active=true;deadline=Date.now()+Number($('#duration').value)*1000;window.EStackPrototypeDSP.apply(config=>{config.signalGenerator={active:true,type:$('#signalType').value,frequency:Number($('#frequency').value),level:Number($('#level').value),targets:[...targets],duration:Number($('#duration').value)};},'start simulated test signal');clearInterval(timer);timer=setInterval(tick,250);render();tick(); };
  const stop = reason => { active=false;clearInterval(timer);window.EStackPrototypeDSP.apply(config=>{config.signalGenerator={active:false,reason};},'stop simulated test signal');render();tick(); };
  $('#signalType').addEventListener('change',render);$('#level').addEventListener('input',render);$('#startSignal').addEventListener('click',start);$('#stopSignal').addEventListener('click',()=>stop('operator stop'));
  window.EStackPrototypeDSP.subscribe(config=>{if(config.connected)$('#signalState').title='CamillaDSP connection contract ready';});render();
})();
