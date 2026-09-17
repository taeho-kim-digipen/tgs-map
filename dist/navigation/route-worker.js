'use strict';
importScripts('./core.js');
const grids=new Map();
self.onmessage=event=>{
  const {id,mapId,config,from,bounds}=event.data;
  try{if(config)grids.set(mapId,TGSNavigation.makeGrid(config));const grid=grids.get(mapId);if(!grid)throw Error('missing-grid');self.postMessage({id,result:TGSNavigation.routeToBooth(grid,from,bounds)});}
  catch(error){self.postMessage({id,error:error.message});}
};
