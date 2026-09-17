/* No map service, coordinates in URLs, telemetry, movement recording or storage. */
(function(root){
'use strict';
function createSensors(onChange,env=root){
  const N=root.TGSNavigation,doc=env.document,nav=env.navigator;
  let active=false,watch=null,generation=0,timer=null,fix=null,heading=null,headingTime=0,lastFixTime=0,status='idle',permission='prompt';
  function snapshot(){const now=Date.now();return {active,fix,heading:heading!==null&&now-headingTime<5000&&!doc.hidden?heading:null,fresh:!!fix&&now-fix.timestamp<30000&&fix.accuracy<=50&&!doc.hidden,status,permission};}
  function emit(){onChange(snapshot());}
  function clear(){generation++;if(watch!==null)nav.geolocation?.clearWatch(watch);watch=null;}
  function orientation(e){if(!active||doc.hidden)return;const h=N.compass(e,env.screen?.orientation?.angle??env.orientation??0);if(h===null)return;heading=heading===null?h:heading+(N.norm(h-heading+180)-180)*.25;headingTime=Date.now();emit();}
  function requestCompass(){
    const api=env.DeviceOrientationEvent;
    if(!api){permission='unsupported';return Promise.resolve();}
    if(typeof api.requestPermission!=='function'){permission='granted';return Promise.resolve();}
    // Called synchronously in a tap handler, before any await.
    try{return api.requestPermission(true).then(value=>{permission=value;emit();}).catch(()=>{permission='denied';emit();});}
    catch{permission='denied';return Promise.resolve();}
  }
  function begin(){
    clear();if(!active||doc.hidden)return;
    if(!env.isSecureContext||!nav.geolocation){status='unavailable';emit();return;}
    status='waiting';const token=generation;emit();
    try{watch=nav.geolocation.watchPosition(p=>{
      if(!active||generation!==token||!N.validFix(p)||p.timestamp<=lastFixTime)return;
      lastFixTime=p.timestamp;fix={latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy,timestamp:p.timestamp};status=fix.accuracy>50?'weak':'tracking';emit();
    },e=>{if(!active||generation!==token)return;status=e.code===1?'denied':'waiting';fix=null;emit();},{enableHighAccuracy:true,maximumAge:0,timeout:15000});}
    catch{status='unavailable';emit();}
  }
  function start(){const request=requestCompass();if(!active){active=true;lastFixTime=0;env.addEventListener('deviceorientation',orientation);env.addEventListener('deviceorientationabsolute',orientation);timer=env.setInterval(emit,1000);begin();}return request;}
  function stop(){active=false;clear();env.clearInterval(timer);timer=null;fix=null;heading=null;headingTime=0;status='idle';env.removeEventListener('deviceorientation',orientation);env.removeEventListener('deviceorientationabsolute',orientation);emit();}
  function visibility(){headingTime=0;if(active){if(doc.hidden){clear();status='paused';emit();}else begin();}}
  doc.addEventListener('visibilitychange',visibility);
  env.addEventListener('pagehide',clear);env.addEventListener('pageshow',()=>{if(active&&watch===null)begin();});
  return {start,stop,snapshot,requestCompass};
}
root.TGSNavigationSensors={createSensors};if(typeof module!=='undefined')module.exports={createSensors};
})(typeof window==='undefined'?globalThis:window);
