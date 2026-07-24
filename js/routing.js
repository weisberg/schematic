"use strict";

/* ------------------------------------------------------------------
   Smart link routing

   Routing is page-local edge-instance geometry.  This module never changes a
   canonical relationship merely to improve its path.  Automatic paths are
   deterministic, explicit waypoints and junctions are hard constraints, and
   locked/manual geometry is validated rather than silently replaced.
   ------------------------------------------------------------------ */

const ROUTING_ALGORITHM = "orthogonal-corridor";
const ROUTING_VERSION = 1;
const ROUTING_DEFAULT_CLEARANCE = 16;
const ROUTING_DEFAULT_STABILITY = .72;
const ROUTING_MAX_POINTS = 128;
const ROUTING_MAX_CANDIDATE_AXIS = 18;
const ROUTING_PORT_TYPES = Object.freeze([
  ["","Untyped"],["data","Data"],["control","Control"],["event","Event"],
  ["api","API"],["read","Read"],["write","Write"],["input","Input"],
  ["output","Output"],["error","Error"],["authentication","Authentication"]
]);
const ROUTING_MODES = Object.freeze([
  ["automatic","Automatic"],["constrained","Constrained automatic"],
  ["manual","Manual"],["locked","Locked"]
]);

let routingPreview = null;
let routingGeneration = 0;
let routingRenderCrossings = new Map();
let routingTransientDiagnostics = new Map();
let routingExpandedBundles = new Set();
let routingTransientSequence=0;

function routingClone(value){
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
function routingId(prefix){
  return `${prefix}-${typeof uid === "function" ? uid() : Date.now().toString(36)}`;
}
function routingTransientId(prefix){
  routingTransientSequence++;
  return `${prefix}-transient-${routingTransientSequence.toString(36)}`;
}
function routingFinite(value,fallback = 0){
  const number=Number(value);
  return Number.isFinite(number)?number:fallback;
}
function routingClamp(value,min,max,fallback){
  const number=Number(value);
  return Number.isFinite(number)?Math.min(max,Math.max(min,number)):fallback;
}
function routingPoint(raw){
  if(!raw||typeof raw!=="object")return null;
  const x=Number(raw.x),y=Number(raw.y);
  return Number.isFinite(x)&&Number.isFinite(y)
    ? {x:Math.round(x*1000)/1000,y:Math.round(y*1000)/1000}:null;
}
function routingPointKey(point){
  return `${Math.round(point.x*1000)}:${Math.round(point.y*1000)}`;
}
function routingSamePoint(a,b,epsilon=.001){
  return !!a&&!!b&&Math.abs(a.x-b.x)<=epsilon&&Math.abs(a.y-b.y)<=epsilon;
}
function routingNormalizePoints(raw,opts={}){
  const result=[];
  for(const candidate of Array.isArray(raw)?raw:[]){
    const point=routingPoint(candidate);
    if(!point)continue;
    const previous=result[result.length-1];
    if(previous&&routingSamePoint(previous,point))continue;
    const next={...candidate,...point};
    if(opts.ids){
      next.id=String(candidate.id||`${opts.prefix||"point"}-${result.length+1}`);
      next.owner=candidate.owner==="router"?"router":"user";
      if(candidate.locked===true)next.locked=true;else delete next.locked;
    }
    result.push(next);
    if(result.length>=ROUTING_MAX_POINTS)break;
  }
  return result;
}
function routingCompactPoints(raw,preserve=[]){
  const preserved=new Set((preserve||[]).map(item=>
    typeof item==="string"?item:routingPointKey(item)));
  const points=routingNormalizePoints(raw);
  if(points.length<3)return points;
  const result=[points[0]];
  for(let index=1;index<points.length-1;index++){
    const previous=result[result.length-1],point=points[index],next=points[index+1];
    const collinear=(previous.x===point.x&&point.x===next.x)||
      (previous.y===point.y&&point.y===next.y);
    if(collinear&&!preserved.has(routingPointKey(point)))continue;
    result.push(point);
  }
  result.push(points[points.length-1]);
  return result;
}
function routingPathSignature(points){
  return routingCompactPoints(points).map(point=>routingPointKey(point)).join("|");
}
function routingPathLength(points){
  let total=0;
  for(let index=1;index<(points||[]).length;index++)
    total+=Math.hypot(points[index].x-points[index-1].x,points[index].y-points[index-1].y);
  return total;
}
function routingTurnCount(points){
  let total=0;
  for(let index=1;index<(points||[]).length-1;index++){
    const a=points[index-1],b=points[index],c=points[index+1];
    if(Math.abs((b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x))>.001)total++;
  }
  return total;
}
function routingPathIsOrthogonal(points){
  for(let index=1;index<(points||[]).length;index++)
    if(points[index-1].x!==points[index].x&&points[index-1].y!==points[index].y)return false;
  return true;
}
function routingOrthogonalize(points,preserve=[]){
  const result=[];
  for(const point of routingNormalizePoints(points)){
    const previous=result[result.length-1];
    if(previous&&previous.x!==point.x&&previous.y!==point.y)
      result.push({x:point.x,y:previous.y});
    result.push(point);
  }
  return routingCompactPoints(result,preserve);
}
function routingRouteMode(edge){
  if(edge&&["automatic","constrained","manual","locked"].includes(edge.routeMode))
    return edge.routeMode;
  if(edge&&Array.isArray(edge.routeWaypoints)&&edge.routeWaypoints.length)return "constrained";
  if(edge&&edge.routeAlgorithm&&Array.isArray(edge.routePoints))return "automatic";
  if(edge&&Array.isArray(edge.routePoints)&&edge.routePoints.length)return "manual";
  if(edge&&typeof hasCustomOrthoBend==="function"&&hasCustomOrthoBend(edge))return "manual";
  return "automatic";
}
function routingClearance(edge){
  return routingClamp(edge&&edge.routeClearance,4,96,ROUTING_DEFAULT_CLEARANCE);
}
function routingStability(edge){
  return routingClamp(edge&&edge.routeStability,0,1,ROUTING_DEFAULT_STABILITY);
}
function routingCleanWaypoint(raw,index){
  const point=routingPoint(raw);
  if(!point)return null;
  const waypoint={
    ...raw,...point,id:String(raw.id||`waypoint-${index+1}`),
    owner:raw.owner==="router"?"router":"user"
  };
  if(raw.locked===true)waypoint.locked=true;else delete waypoint.locked;
  return waypoint;
}
function routingCleanJunction(raw,index){
  const point=routingPoint(raw);
  if(!point)return null;
  const kind=raw.kind==="bus"?"bus":"junction";
  const result={
    ...raw,...point,id:String(raw.id||`junction-${index+1}`),kind,
    order:Number.isFinite(Number(raw.order))?Number(raw.order):index
  };
  if(kind==="bus"){
    result.orientation=raw.orientation==="vertical"?"vertical":"horizontal";
    result.length=routingClamp(raw.length,24,480,96);
  }else{
    delete result.orientation;delete result.length;
  }
  return result;
}
function routingCleanEdgeForDocument(edge){
  if(!edge||typeof edge!=="object")return edge;
  const mode=routingRouteMode(edge);
  if(mode==="automatic")delete edge.routeMode;else edge.routeMode=mode;
  const points=routingNormalizePoints(edge.routePoints);
  if(points.length)edge.routePoints=points;else delete edge.routePoints;
  const waypoints=(Array.isArray(edge.routeWaypoints)?edge.routeWaypoints:[])
    .map(routingCleanWaypoint).filter(Boolean).slice(0,ROUTING_MAX_POINTS);
  if(waypoints.length)edge.routeWaypoints=waypoints;else delete edge.routeWaypoints;
  const junctions=(Array.isArray(edge.routeJunctions)?edge.routeJunctions:[])
    .map(routingCleanJunction).filter(Boolean).slice(0,ROUTING_MAX_POINTS);
  if(junctions.length)edge.routeJunctions=junctions;else delete edge.routeJunctions;
  const clearance=routingClearance(edge);
  if(clearance===ROUTING_DEFAULT_CLEARANCE)delete edge.routeClearance;
  else edge.routeClearance=clearance;
  const stability=routingStability(edge);
  if(Math.abs(stability-ROUTING_DEFAULT_STABILITY)<.0001)delete edge.routeStability;
  else edge.routeStability=stability;
  if(edge.routeAlgorithm)edge.routeAlgorithm=String(edge.routeAlgorithm).slice(0,80);
  else delete edge.routeAlgorithm;
  const version=Number(edge.routeVersion);
  if(Number.isInteger(version)&&version>0)edge.routeVersion=version;else delete edge.routeVersion;
  if(edge.routeChecksum)edge.routeChecksum=String(edge.routeChecksum).slice(0,240);
  else delete edge.routeChecksum;
  if(edge.bridgeMode&&!["auto","over","under","none"].includes(edge.bridgeMode))
    delete edge.bridgeMode;
  if(!edge.bridgeMode||edge.bridgeMode==="auto")delete edge.bridgeMode;
  if(edge.bundleId)edge.bundleId=String(edge.bundleId).slice(0,100);else delete edge.bundleId;
  if(edge.bundleExpanded!==true)delete edge.bundleExpanded;
  if(edge.fromPortUnresolved!==true)delete edge.fromPortUnresolved;
  if(edge.toPortUnresolved!==true)delete edge.toPortUnresolved;
  if(edge.portCompatibilityOverride!==true)delete edge.portCompatibilityOverride;
  const offset=routingClamp(edge.labelOffset,-160,160,0);
  if(Math.abs(offset)<.001)delete edge.labelOffset;else edge.labelOffset=offset;
  if(edge.routeDiagnostic&&typeof edge.routeDiagnostic==="object"){
    const code=String(edge.routeDiagnostic.code||"").slice(0,80);
    if(code){
      edge.routeDiagnostic={
        code,
        message:String(edge.routeDiagnostic.message||"").slice(0,500),
        obstacleIds:[...new Set((edge.routeDiagnostic.obstacleIds||[]).map(String))].slice(0,40)
      };
    }else delete edge.routeDiagnostic;
  }else delete edge.routeDiagnostic;
  for(const key of ["routePreview","routeTransient","routeGeneration"])delete edge[key];
  return edge;
}

function routingNodeObstacle(node,clearance){
  if(!node)return null;
  const rect=typeof nodeVisualRect==="function"?nodeVisualRect(node):nodeRect(node);
  let x=rect.x,y=rect.y,w=rect.w,h=rect.h,type=node.type;
  if(node.type==="frame"&&node.collapsed!==true)h=Math.min(36,rect.h);
  else if(node.type==="swimlane"){
    const orientation=typeof swimlaneOrientation==="function"?swimlaneOrientation(node):
      node.orientation==="vertical"?"vertical":"horizontal";
    const defaults=typeof swimlaneDefaults==="function"?swimlaneDefaults(node):{titleSize:44};
    if(orientation==="horizontal")w=Math.min(defaults.titleSize||44,rect.w);
    else h=Math.min(defaults.titleSize||44,rect.h);
    type="swimlane-header";
  }
  return {
    id:String(node.id),type,
    x:x-clearance,y:y-clearance,w:w+clearance*2,h:h+clearance*2,
    sourceRect:{x,y,w,h}
  };
}
function routingObstacleRects(edge,clearance=routingClearance(edge),opts={}){
  const hidden=typeof hiddenCanvasNodeIds==="function"?hiddenCanvasNodeIds():
    typeof collapsedFrameHiddenNodeIds==="function"?collapsedFrameHiddenNodeIds():new Set();
  const result=[];
  for(const node of state.nodes||[]){
    if(node.id===edge.from||node.id===edge.to||hidden.has(node.id))continue;
    if(typeof organizationObjectHidden==="function"&&organizationObjectHidden(node))continue;
    const obstacle=routingNodeObstacle(node,clearance);
    if(obstacle)result.push(obstacle);
  }
  return result.sort((a,b)=>a.x-b.x||a.y-b.y||a.id.localeCompare(b.id));
}
function routingSegmentHitsRect(a,b,rect){
  const epsilon=.001;
  if(a.x===b.x){
    if(a.x<=rect.x+epsilon||a.x>=rect.x+rect.w-epsilon)return false;
    const min=Math.min(a.y,b.y),max=Math.max(a.y,b.y);
    return max>rect.y+epsilon&&min<rect.y+rect.h-epsilon;
  }
  if(a.y===b.y){
    if(a.y<=rect.y+epsilon||a.y>=rect.y+rect.h-epsilon)return false;
    const min=Math.min(a.x,b.x),max=Math.max(a.x,b.x);
    return max>rect.x+epsilon&&min<rect.x+rect.w-epsilon;
  }
  const steps=Math.max(2,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/8));
  for(let index=1;index<steps;index++){
    const t=index/steps,x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t;
    if(x>rect.x+epsilon&&x<rect.x+rect.w-epsilon&&
       y>rect.y+epsilon&&y<rect.y+rect.h-epsilon)return true;
  }
  return false;
}
function routingPathCollisions(points,obstacles){
  const ids=new Set();
  for(let index=1;index<(points||[]).length;index++)
    for(const obstacle of obstacles||[])
      if(routingSegmentHitsRect(points[index-1],points[index],obstacle))ids.add(obstacle.id);
  return [...ids].sort();
}
function routingPathValid(points,obstacles){
  return routingPathIsOrthogonal(points)&&routingPathCollisions(points,obstacles).length===0;
}
function routingRectDistanceToPoint(rect,point){
  const dx=Math.max(rect.x-point.x,0,point.x-(rect.x+rect.w));
  const dy=Math.max(rect.y-point.y,0,point.y-(rect.y+rect.h));
  return Math.hypot(dx,dy);
}
function routingRelevantObstacles(start,end,obstacles){
  const minX=Math.min(start.x,end.x)-320,maxX=Math.max(start.x,end.x)+320;
  const minY=Math.min(start.y,end.y)-320,maxY=Math.max(start.y,end.y)+320;
  return (obstacles||[]).filter(rect=>
    rect.x+rect.w>=minX&&rect.x<=maxX&&rect.y+rect.h>=minY&&rect.y<=maxY);
}
function routingAxisCandidates(start,end,obstacles,axis,existing=[]){
  const values=[start[axis],end[axis]];
  for(const point of existing||[])values.push(point[axis]);
  for(const rect of obstacles||[]){
    if(axis==="x")values.push(rect.x,rect.x+rect.w);
    else values.push(rect.y,rect.y+rect.h);
  }
  if(obstacles&&obstacles.length){
    if(axis==="x"){
      values.push(Math.min(...obstacles.map(rect=>rect.x))-24,
        Math.max(...obstacles.map(rect=>rect.x+rect.w))+24);
    }else{
      values.push(Math.min(...obstacles.map(rect=>rect.y))-24,
        Math.max(...obstacles.map(rect=>rect.y+rect.h))+24);
    }
  }
  const middle=(start[axis]+end[axis])/2;
  return [...new Set(values.filter(Number.isFinite).map(value=>Math.round(value*1000)/1000))]
    .sort((a,b)=>Math.abs(a-middle)-Math.abs(b-middle)||a-b)
    .slice(0,ROUTING_MAX_CANDIDATE_AXIS);
}
function routingCandidateCost(points,opts={}){
  let cost=routingPathLength(points)+routingTurnCount(points)*34;
  const existing=opts.existing||[];
  if(existing.length&&opts.stability>0){
    let movement=0;
    for(const point of points){
      let nearest=Infinity;
      for(const old of existing)nearest=Math.min(nearest,Math.hypot(point.x-old.x,point.y-old.y));
      movement+=Number.isFinite(nearest)?nearest:0;
    }
    cost+=movement*opts.stability*.22;
  }
  return cost;
}
function routingFindLeg(start,end,obstacles,opts={}){
  const relevant=routingRelevantObstacles(start,end,obstacles);
  const candidates=[];
  const add=points=>{
    const clean=routingCompactPoints(routingOrthogonalize(points));
    if(!routingPathValid(clean,relevant))return;
    candidates.push({
      points:clean,cost:routingCandidateCost(clean,opts),signature:routingPathSignature(clean)
    });
  };
  if(start.x===end.x||start.y===end.y)add([start,end]);
  add([start,{x:end.x,y:start.y},end]);
  add([start,{x:start.x,y:end.y},end]);
  const xs=routingAxisCandidates(start,end,relevant,"x",opts.existing);
  const ys=routingAxisCandidates(start,end,relevant,"y",opts.existing);
  for(const x of xs)add([start,{x,y:start.y},{x,y:end.y},end]);
  for(const y of ys)add([start,{x:start.x,y},{x:end.x,y},end]);
  if(!candidates.length){
    for(const x of xs.slice(0,12))for(const y of ys.slice(0,12))
      add([start,{x,y:start.y},{x,y},{x:end.x,y},end]);
  }
  candidates.sort((a,b)=>a.cost-b.cost||a.signature.localeCompare(b.signature));
  return candidates[0]||null;
}
function routingFindPath(start,end,obstacles,opts={}){
  const constraints=routingNormalizePoints(opts.waypoints);
  const preserve=constraints.map(routingPointKey);
  const existing=routingNormalizePoints(opts.existing);
  if(existing.length&&routingSamePoint(existing[0],start)&&
     routingSamePoint(existing[existing.length-1],end)&&
     routingPathValid(existing,obstacles)&&
     constraints.every(point=>existing.some(candidate=>routingSamePoint(point,candidate)))&&
     opts.force!==true){
    return {
      ok:true,points:routingCompactPoints(existing,preserve),
      changed:false,collisions:[],reason:"existing-valid"
    };
  }
  const anchors=[start,...constraints,end];
  const points=[start];
  for(let index=1;index<anchors.length;index++){
    const leg=routingFindLeg(anchors[index-1],anchors[index],obstacles,{
      existing,stability:routingClamp(opts.stability,0,1,ROUTING_DEFAULT_STABILITY)
    });
    if(!leg){
      const fallback=existing.length?existing:[start,end];
      return {
        ok:false,points:routingOrthogonalize(fallback),
        changed:false,collisions:routingPathCollisions(fallback,obstacles),
        reason:"no-clear-corridor"
      };
    }
    points.push(...leg.points.slice(1));
  }
  const next=routingCompactPoints(points,preserve);
  const candidates=[{
    points:next,cost:routingCandidateCost(next,{existing,stability:opts.stability}),
    signature:routingPathSignature(next),reason:"routed"
  }];
  if(existing.length&&routingPathValid(existing,obstacles)&&
     constraints.every(point=>existing.some(candidate=>routingSamePoint(point,candidate)))){
    candidates.push({
      points:routingCompactPoints(existing,preserve),
      cost:routingCandidateCost(existing,{existing,stability:opts.stability})-2,
      signature:routingPathSignature(existing),reason:"stable-existing"
    });
  }
  candidates.sort((a,b)=>a.cost-b.cost||a.signature.localeCompare(b.signature));
  const winner=candidates[0];
  return {
    ok:true,points:winner.points,
    changed:routingPathSignature(winner.points)!==routingPathSignature(existing),
    collisions:[],reason:winner.reason
  };
}
function routingEndpointStub(point,distance){
  if(point.side==="e")return{x:point.x+distance,y:point.y};
  if(point.side==="w")return{x:point.x-distance,y:point.y};
  if(point.side==="s")return{x:point.x,y:point.y+distance};
  return{x:point.x,y:point.y-distance};
}
function routingConstraintPoints(edge){
  const entries=[];
  for(const waypoint of routingNormalizePoints(edge&&edge.routeWaypoints,{ids:true,prefix:"waypoint"}))
    entries.push({...waypoint,constraintKind:"waypoint"});
  for(const junction of (Array.isArray(edge&&edge.routeJunctions)?edge.routeJunctions:[])
    .map(routingCleanJunction).filter(Boolean))
    entries.push({...junction,constraintKind:junction.kind});
  return entries.sort((a,b)=>routingFinite(a.order,0)-routingFinite(b.order,0)||
    String(a.id).localeCompare(String(b.id)));
}
function routingAdjustStoredEndpoints(points,pa,pb){
  const result=routingNormalizePoints(points);
  if(!result.length)return result;
  const first=result[0],last=result[result.length-1];
  if(pa.side==="e"||pa.side==="w")first.y=pa.y;else first.x=pa.x;
  if(pb.side==="e"||pb.side==="w")last.y=pb.y;else last.x=pb.x;
  return routingOrthogonalize(result);
}
function routingBuildRoute(edge,pa,pb,points,diagnostic=null,meta={}){
  const clean=routingCompactPoints(points,routingConstraintPoints(edge));
  const style=typeof orthoCornerStyle==="function"?orthoCornerStyle(edge):"rounded";
  const d=style==="square"?squarePolylinePath(clean):roundedPolylinePath(clean);
  const a=clean[1]||pa,b=clean[clean.length-2]||pb;
  const middle=clean[Math.floor(clean.length/2)]||{x:(pa.x+pb.x)/2,y:(pa.y+pb.y)/2};
  return {
    d,points:clean,smartPoints:clean,pa,pb,a,b,bend:middle,
    horizontal:pa.side==="e"||pa.side==="w"||pb.side==="e"||pb.side==="w",
    auto:{x:middle.x,y:middle.y},smart:true,diagnostic,...meta
  };
}
function routingDiagnostic(code,message,obstacleIds=[]){
  return {code,message,obstacleIds:[...new Set(obstacleIds.map(String))].sort().slice(0,40)};
}
function routingResolveOrthoRoute(edge,pa,pb,opts={}){
  if(!edge||!pa||!pb)return null;
  if(typeof hasCustomOrthoBend==="function"&&hasCustomOrthoBend(edge)&&
     !edge.routeMode&&!edge.routeAlgorithm&&!Array.isArray(edge.routePoints)&&
     !Array.isArray(edge.routeWaypoints)&&!Array.isArray(edge.routeJunctions))
    return null;
  const mode=routingRouteMode(edge);
  const legacy=typeof legacyOrthoEdgeRoute==="function"
    ? legacyOrthoEdgeRoute(edge,pa,pb):null;
  const hasSmartState=Array.isArray(edge.routePoints)||Array.isArray(edge.routeWaypoints)||
    Array.isArray(edge.routeJunctions)||edge.routeMode||edge.routeAlgorithm;
  const clearance=routingClearance(edge);
  const startStub=routingEndpointStub(pa,Number.isFinite(edge.orthoFromStub)
    ?Math.max(0,edge.orthoFromStub):Math.max(12,clearance*.75));
  const endStub=routingEndpointStub(pb,Number.isFinite(edge.orthoToStub)
    ?Math.max(0,edge.orthoToStub):Math.max(12,clearance*.75));
  let stored=routingAdjustStoredEndpoints(edge.routePoints,pa,pb);
  if(!stored.length&&legacy)stored=legacy.points.slice(1,-1);
  const existing=[pa,...stored,pb];
  const obstacles=routingObstacleRects(edge,clearance,opts);
  const constraints=routingConstraintPoints(edge);
  if((mode==="manual"||mode==="locked")&&stored.length){
    const points=routingOrthogonalize([pa,...stored,pb]);
    const collisions=routingPathCollisions(points,obstacles);
    const diagnostic=collisions.length
      ? routingDiagnostic("route-obstructed",
        `${mode==="locked"?"Locked":"Manual"} route intersects ${collisions.length} obstacle${collisions.length===1?"":"s"}.`,
        collisions):null;
    routingTransientDiagnostics.set(edge.id,diagnostic);
    return routingBuildRoute(edge,pa,pb,points,diagnostic,{mode,changed:false});
  }
  const legacyPoints=legacy?legacy.points:[pa,startStub,endStub,pb];
  if(!hasSmartState&&!constraints.length&&routingPathValid(legacyPoints,obstacles)){
    routingTransientDiagnostics.delete(edge.id);
    return null;
  }
  const coreExisting=stored.length?[startStub,...stored.slice(1,-1),endStub]:
    [startStub,...legacyPoints.slice(2,-2),endStub];
  const result=routingFindPath(startStub,endStub,obstacles,{
    waypoints:constraints,existing:coreExisting,
    stability:routingStability(edge),force:opts.force===true
  });
  let diagnostic=null;
  if(!result.ok){
    diagnostic=routingDiagnostic("no-clear-route",
      "No collision-free route satisfies the current ports, waypoints, junctions, and clearance.",
      result.collisions);
  }
  const full=routingOrthogonalize([pa,...result.points,pb],constraints);
  routingTransientDiagnostics.set(edge.id,diagnostic);
  return routingBuildRoute(edge,pa,pb,full,diagnostic,{
    mode,constraints,changed:result.changed,routeReason:result.reason,
    metrics:{
      length:Math.round(routingPathLength(full)*100)/100,
      turns:routingTurnCount(full),
      collisions:result.collisions.length
    }
  });
}
function routingStoreResolvedRoute(edge,route,mode=routingRouteMode(edge),opts={}){
  if(!edge||!route)return false;
  edge.routing="ortho";
  edge.routeMode=mode;
  edge.routeAlgorithm=ROUTING_ALGORITHM;
  edge.routeVersion=ROUTING_VERSION;
  edge.routePoints=routingNormalizePoints((route.points||[]).slice(1,-1));
  edge.routeChecksum=routingPathSignature(route.points||[]);
  if(route.diagnostic)edge.routeDiagnostic=routingClone(route.diagnostic);
  else delete edge.routeDiagnostic;
  if(mode==="automatic")delete edge.routeMode;
  if(opts.resetConstraints){
    delete edge.routeWaypoints;
    delete edge.routeJunctions;
    delete edge.orthoX;delete edge.orthoY;
    delete edge.orthoFromStub;delete edge.orthoToStub;
  }
  return true;
}
function routingEdgeDiagnostic(edge){
  return edge&&edge.routeDiagnostic||routingTransientDiagnostics.get(edge&&edge.id)||null;
}
function routingSetCornerPosition(edge,route,corner,point){
  if(!edge||!route||!corner||!point)return false;
  const points=routingNormalizePoints(route.smartPoints||route.points);
  const index=Number(corner.pointIndex);
  if(!Number.isInteger(index)||index<=0||index>=points.length-1)return false;
  const previous=points[index-1],current=points[index],next=points[index+1];
  const target={x:routingFinite(point.x,current.x),y:routingFinite(point.y,current.y)};
  const axes=Array.isArray(corner.axes)&&corner.axes.length?corner.axes:["x","y"];
  if(!axes.includes("x"))target.x=current.x;
  if(!axes.includes("y"))target.y=current.y;
  const incomingHorizontal=previous.y===current.y;
  const outgoingHorizontal=current.y===next.y;
  current.x=target.x;current.y=target.y;
  if(incomingHorizontal)previous.y=target.y;else previous.x=target.x;
  if(outgoingHorizontal)next.y=target.y;else next.x=target.x;
  edge.routePoints=routingNormalizePoints(points.slice(1,-1));
  edge.routeMode="manual";
  edge.routeAlgorithm=ROUTING_ALGORITHM;
  edge.routeVersion=ROUTING_VERSION;
  edge.routeChecksum=routingPathSignature(points);
  delete edge.routeDiagnostic;
  for(const key of ["orthoX","orthoY","orthoFromStub","orthoToStub"])delete edge[key];
  return true;
}
function routingCornerHandles(route){
  if(!route||!route.smart)return null;
  const points=routingNormalizePoints(route.smartPoints||route.points);
  const handles=[];
  for(let index=1;index<points.length-1;index++){
    const previous=points[index-1],point=points[index],next=points[index+1];
    const cross=(point.x-previous.x)*(next.y-point.y)-(point.y-previous.y)*(next.x-point.x);
    if(Math.abs(cross)<.001)continue;
    let axes=["x","y"];
    if(index===1)
      axes=[previous.y===point.y?"x":"y"];
    if(index===points.length-2){
      const endpointAxis=point.y===next.y?"x":"y";
      axes=axes.includes(endpointAxis)?[endpointAxis]:axes;
    }
    handles.push({
      key:`route-${index}`,axes,pointIndex:index,
      point:{x:point.x,y:point.y},owner:"route"
    });
  }
  return handles;
}
function routingAddWaypoint(edge,point=null,opts={}){
  if(!edge)return null;
  const ep=edgeEndpoints(edge);
  if(!ep)return null;
  const route=orthoEdgeRoute({...edge,routeMode:"automatic"},ep.pa,ep.pb);
  const target=point||polylinePointAt(route.points,edgeLabelPosition(edge));
  const projected=projectPointToPolyline(route.points,target);
  if(opts.history!==false)pushHistory();
  const waypoint={
    id:routingId("waypoint"),x:Math.round(projected.x),y:Math.round(projected.y),
    owner:"user",order:(edge.routeWaypoints||[]).length
  };
  edge.routing="ortho";
  edge.routeWaypoints=[...(edge.routeWaypoints||[]),waypoint];
  edge.routeMode="constrained";
  delete edge.routePoints;delete edge.routeDiagnostic;
  render();
  announce("Added a user waypoint. Automatic routing will preserve it.");
  return waypoint;
}
function routingRemoveWaypoint(edge,waypointId,opts={}){
  if(!edge||!Array.isArray(edge.routeWaypoints))return false;
  const before=edge.routeWaypoints.length;
  const next=edge.routeWaypoints.filter(point=>point.id!==waypointId);
  if(next.length===before)return false;
  if(opts.history!==false)pushHistory();
  if(next.length)edge.routeWaypoints=next;else delete edge.routeWaypoints;
  if(routingRouteMode(edge)==="constrained"&&!next.length&&!(edge.routeJunctions||[]).length)
    delete edge.routeMode;
  delete edge.routePoints;delete edge.routeDiagnostic;
  if(opts.render!==false)render();
  return true;
}
function routingMoveWaypoint(edge,waypointId,point,opts={}){
  if(!edge||!Array.isArray(edge.routeWaypoints))return false;
  const waypoint=edge.routeWaypoints.find(item=>item.id===waypointId);
  if(!waypoint)return false;
  if(opts.history!==false)pushHistory(`route-waypoint:${edge.id}:${waypointId}`);
  waypoint.x=routingFinite(point.x,waypoint.x);
  waypoint.y=routingFinite(point.y,waypoint.y);
  waypoint.owner="user";edge.routeMode="constrained";
  delete edge.routePoints;delete edge.routeDiagnostic;
  if(opts.render!==false)render();
  return true;
}
function routingSnapConstraintPoint(edge,point,shiftHeld=false,threshold=10/view.k){
  let x=point.x,y=point.y,snapX=null,snapY=null;
  if(shiftHeld||snapToGrid){
    const grid=(typeof editingGridSize==="function"?editingGridSize():GRID_SNAP)/2;
    x=Math.round(x/grid)*grid;y=Math.round(y/grid)*grid;snapX=x;snapY=y;
  }
  const candidatesX=[],candidatesY=[];
  for(const other of state.edges||[]){
    if(other===edge)continue;
    const route=routingPolylineForEdge(other);
    for(const candidate of route?.points||[]){
      candidatesX.push(candidate.x);candidatesY.push(candidate.y);
    }
  }
  for(const node of visibleCanvasNodes()){
    const r=typeof nodeVisualRect==="function"?nodeVisualRect(node):nodeRect(node);
    candidatesX.push(r.x,r.cx,r.x+r.w);candidatesY.push(r.y,r.cy,r.y+r.h);
  }
  const best=(value,candidates)=>{
    let winner=null;
    for(const candidate of candidates){
      const delta=Math.abs(candidate-value);
      if(delta<=threshold&&(!winner||delta<winner.delta))winner={value:candidate,delta};
    }
    return winner;
  };
  const bx=best(x,candidatesX),by=best(y,candidatesY);
  if(bx){x=bx.value;snapX=x;}if(by){y=by.value;snapY=y;}
  return{x,y,snapX,snapY};
}
function routingDrawConstraintHandles(edge){
  const t=themeColors();
  for(const waypoint of edge.routeWaypoints||[]){
    const group=el("g",{"data-route-waypoint":waypoint.id,"data-route-waypoint-edge":edge.id,
      cursor:"move",role:"button",tabindex:0,
      "aria-label":`Move route waypoint at ${Math.round(waypoint.x)}, ${Math.round(waypoint.y)}`},draftLayer);
    el("circle",{cx:waypoint.x,cy:waypoint.y,r:7,fill:t.panel,stroke:t.accent,
      "stroke-width":2},group);
    el("circle",{cx:waypoint.x,cy:waypoint.y,r:2,fill:t.accent},group);
    el("title",{},group).textContent="Drag waypoint; hold Shift for half-grid snapping. Delete removes it.";
    group.addEventListener("keydown",event=>{
      if(event.key==="Delete"||event.key==="Backspace"){
        event.preventDefault();event.stopPropagation();routingRemoveWaypoint(edge,waypoint.id);return;
      }
      const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
      if(!delta)return;
      event.preventDefault();event.stopPropagation();
      const step=event.shiftKey?(typeof editingGridSize==="function"?editingGridSize():GRID_SNAP)/2:4;
      routingMoveWaypoint(edge,waypoint.id,{x:waypoint.x+delta[0]*step,y:waypoint.y+delta[1]*step});
    });
  }
}
function routingSetMode(edges,mode,opts={}){
  const targets=(edges||[]).filter(Boolean);
  if(!targets.length||!ROUTING_MODES.some(item=>item[0]===mode))return false;
  if(opts.history!==false)pushHistory();
  for(const edge of targets){
    edge.routing="ortho";
    const ep=edgeEndpoints(edge);
    if(!ep)continue;
    if(mode==="locked"||mode==="manual"){
      const route=orthoEdgeRoute(edge,ep.pa,ep.pb);
      routingStoreResolvedRoute(edge,route,mode);
    }else if(mode==="constrained"){
      edge.routeMode="constrained";
      delete edge.routeDiagnostic;
    }else{
      delete edge.routeMode;delete edge.routePoints;delete edge.routeDiagnostic;
      edge.routeAlgorithm=ROUTING_ALGORITHM;edge.routeVersion=ROUTING_VERSION;
    }
  }
  if(opts.render!==false)render();
  return true;
}
function routingResetEdges(edges,opts={}){
  const targets=(edges||[]).filter(Boolean);
  if(!targets.length)return false;
  if(opts.preview!==false)return routingOpenPreview(targets.map(edge=>edge.id),{reset:true});
  if(opts.history!==false)pushHistory();
  for(const edge of targets){
    edge.routing="ortho";
    for(const key of ["routeMode","routePoints","routeWaypoints","routeJunctions","routeDiagnostic",
      "routeChecksum","orthoX","orthoY","orthoFromStub","orthoToStub"])delete edge[key];
    edge.routeAlgorithm=ROUTING_ALGORITHM;edge.routeVersion=ROUTING_VERSION;
  }
  if(opts.render!==false)render();
  return true;
}

/* ---------------- Crossings, bridges, bundles, and junctions ---------------- */

let routingPreparedRoutes=new Map();
let routingPreparedEdges=new Map();
let routingPreparedHidden=null;
let routingPreparedProxies=null;

function routingPolylineForEdge(edge,hidden=routingPreparedHidden,proxies=routingPreparedProxies){
  const cached=routingPreparedRoutes.get(edge&&edge.id);
  if(cached)return cached;
  const ep=edgeEndpoints(edge,hidden,proxies);
  if(!ep)return null;
  let route;
  if(edge.routing==="ortho"){
    route=routingResolveOrthoRoute(edge,ep.pa,ep.pb,{prepare:true})||
      (typeof legacyOrthoEdgeRoute==="function"?legacyOrthoEdgeRoute(edge,ep.pa,ep.pb):
        orthoEdgeRoute(edge,ep.pa,ep.pb));
  }else{
    /* Curves keep their rendering path.  A deterministic sample is sufficient
       for crossing annotation and preview statistics without changing the
       existing curve implementation. */
    const samples=[];
    const count=24;
    if(typeof curveEdgePoint==="function"){
      for(let index=0;index<=count;index++)
        samples.push(curveEdgePoint(ep.pa,ep.pb,index/count));
    }else{
      for(let index=0;index<=count;index++){
        const t=index/count;
        samples.push({x:ep.pa.x+(ep.pb.x-ep.pa.x)*t,y:ep.pa.y+(ep.pb.y-ep.pa.y)*t});
      }
    }
    route={points:samples,pa:ep.pa,pb:ep.pb,smart:false};
  }
  routingPreparedRoutes.set(edge.id,route);
  return route;
}
function routingSegmentIntersection(a,b,c,d){
  const epsilon=.001;
  const denominator=(b.x-a.x)*(d.y-c.y)-(b.y-a.y)*(d.x-c.x);
  if(Math.abs(denominator)<epsilon)return null;
  const t=((c.x-a.x)*(d.y-c.y)-(c.y-a.y)*(d.x-c.x))/denominator;
  const u=((c.x-a.x)*(b.y-a.y)-(c.y-a.y)*(b.x-a.x))/denominator;
  if(t<=.04||t>=.96||u<=.04||u>=.96)return null;
  return {x:a.x+t*(b.x-a.x),y:a.y+t*(b.y-a.y),t,u};
}
function routingSegmentBucketKeys(a,b,size=180){
  const minX=Math.floor(Math.min(a.x,b.x)/size),maxX=Math.floor(Math.max(a.x,b.x)/size);
  const minY=Math.floor(Math.min(a.y,b.y)/size),maxY=Math.floor(Math.max(a.y,b.y)/size);
  const keys=[];
  for(let x=minX;x<=maxX;x++)for(let y=minY;y<=maxY;y++)keys.push(`${x}:${y}`);
  return keys;
}
function routingBridgeWinner(edgeA,edgeB){
  const modeA=edgeA.bridgeMode||"auto",modeB=edgeB.bridgeMode||"auto";
  if(modeA==="none"||modeB==="none")return null;
  if(modeA==="over"&&modeB!=="over")return edgeA;
  if(modeB==="over"&&modeA!=="over")return edgeB;
  if(modeA==="under"&&modeB!=="under")return edgeB;
  if(modeB==="under"&&modeA!=="under")return edgeA;
  return String(edgeA.id).localeCompare(String(edgeB.id))>=0?edgeA:edgeB;
}
function routingCalculateCrossings(edges){
  const buckets=new Map(),segments=[];
  for(const edge of edges){
    const route=routingPolylineForEdge(edge);
    const points=route&&routingNormalizePoints(route.points);
    if(!points||points.length<2)continue;
    for(let index=1;index<points.length;index++){
      const segment={edge,index,a:points[index-1],b:points[index]};
      segments.push(segment);
      for(const key of routingSegmentBucketKeys(segment.a,segment.b)){
        const list=buckets.get(key)||[];
        list.push(segment);buckets.set(key,list);
      }
    }
  }
  const results=new Map(),seen=new Set();
  for(const list of buckets.values()){
    for(let ai=0;ai<list.length;ai++)for(let bi=ai+1;bi<list.length;bi++){
      const a=list[ai],b=list[bi];
      if(a.edge===b.edge)continue;
      const pair=[String(a.edge.id),a.index,String(b.edge.id),b.index].sort().join("|");
      if(seen.has(pair))continue;seen.add(pair);
      if(a.edge.from===b.edge.from||a.edge.from===b.edge.to||
         a.edge.to===b.edge.from||a.edge.to===b.edge.to)continue;
      const point=routingSegmentIntersection(a.a,a.b,b.a,b.b);
      if(!point)continue;
      const winner=routingBridgeWinner(a.edge,b.edge);
      if(!winner)continue;
      const segment=winner===a?a:b;
      const dx=segment.b.x-segment.a.x,dy=segment.b.y-segment.a.y;
      const length=Math.max(.001,Math.hypot(dx,dy));
      const crossing={
        x:point.x,y:point.y,dx:dx/length,dy:dy/length,
        otherId:winner===a?b.edge.id:a.edge.id,
        key:`${[a.edge.id,b.edge.id].sort().join(":")}:${Math.round(point.x)}:${Math.round(point.y)}`
      };
      const result=results.get(winner.id)||[];
      result.push(crossing);results.set(winner.id,result);
    }
  }
  for(const list of results.values())list.sort((a,b)=>a.x-b.x||a.y-b.y||a.key.localeCompare(b.key));
  return results;
}
function routingPrepareRender(edges,hidden=null,proxies=null){
  routingGeneration++;
  routingPreparedRoutes=new Map();
  routingPreparedEdges=new Map((edges||[]).map(edge=>[edge.id,edge]));
  routingPreparedHidden=hidden;
  routingPreparedProxies=proxies;
  routingTransientDiagnostics=new Map();
  for(const edge of edges||[]){
    routingPolylineForEdge(edge,hidden,proxies);
    routingUpdateEdgePortDiagnostic(edge);
  }
  routingRenderCrossings=routingCalculateCrossings(edges||[]);
}
function routingPreparedRoute(edge){
  return routingPreparedRoutes.get(edge&&edge.id)||null;
}
function routingInvalidateEdges(edgeIds){
  for(const id of edgeIds||[])routingPreparedRoutes.delete(id);
  routingGeneration++;
}
function routingLabelPoint(points,position,offset=0){
  const point=polylinePointAt(points,position);
  const normalOffset=routingClamp(offset,-160,160,0);
  if(!normalOffset)return point;
  const before=polylinePointAt(points,Math.max(0,position-.002));
  const after=polylinePointAt(points,Math.min(1,position+.002));
  const dx=after.x-before.x,dy=after.y-before.y,length=Math.max(.001,Math.hypot(dx,dy));
  return{x:point.x-dy/length*normalOffset,y:point.y+dx/length*normalOffset};
}
function routingCurveLabelPoint(pa,pb,position,offset=0,point=null){
  const target=point||curveEdgePointAt(pa,pb,position);
  const normalOffset=routingClamp(offset,-160,160,0);
  if(!normalOffset)return target;
  const before=curveEdgePointAt(pa,pb,Math.max(0,position-.002));
  const after=curveEdgePointAt(pa,pb,Math.min(1,position+.002));
  const dx=after.x-before.x,dy=after.y-before.y,length=Math.max(.001,Math.hypot(dx,dy));
  return{x:target.x-dy/length*normalOffset,y:target.y+dx/length*normalOffset};
}
function routingDrawEdgeBridges(group,edge,color,width){
  const crossings=routingRenderCrossings.get(edge.id)||[];
  if(!crossings.length)return;
  const t=themeColors();
  for(const crossing of crossings){
    const radius=Math.max(5,4+width*1.5);
    const nx=-crossing.dy,ny=crossing.dx;
    const start={x:crossing.x-crossing.dx*radius,y:crossing.y-crossing.dy*radius};
    const end={x:crossing.x+crossing.dx*radius,y:crossing.y+crossing.dy*radius};
    const control={x:crossing.x+nx*radius*.82,y:crossing.y+ny*radius*.82};
    const d=`M ${pathNumber(start.x)} ${pathNumber(start.y)} Q `+
      `${pathNumber(control.x)} ${pathNumber(control.y)} ${pathNumber(end.x)} ${pathNumber(end.y)}`;
    el("path",{d,fill:"none",stroke:t.canvas||t.bg||"#F4F6F8",
      "stroke-width":width+5,"stroke-linecap":"round","pointer-events":"none",
      "data-edge-bridge-underlay":"1"},group);
    el("path",{d,fill:"none",stroke:color,"stroke-width":width,
      "stroke-dasharray":edgeDashArray(edge),"stroke-linecap":"round","pointer-events":"none",
      "data-edge-bridge":crossing.otherId},group);
  }
}
function routingDrawBridgeLayer(edges){
  if(typeof bridgeLayer==="undefined"||!bridgeLayer)return;
  for(const edge of edges||[]){
    if(!(routingRenderCrossings.get(edge.id)||[]).length)continue;
    routingDrawEdgeBridges(
      bridgeLayer,edge,edgeLineColor(edge,themeColors()),edgeLineWidth(edge)
    );
  }
}
function routingDiagnosticLabel(diagnostic){
  if(!diagnostic)return"";
  if(diagnostic.code==="unresolved-port")return"Unresolved port binding";
  if(diagnostic.code==="port-incompatible")return"Port type exception";
  return diagnostic.message||"Route needs attention";
}
function routingDrawEdgeDiagnostic(group,edge){
  const diagnostic=routingEdgeDiagnostic(edge);
  if(!diagnostic)return;
  const route=routingPolylineForEdge(edge);
  if(!route||!route.points?.length)return;
  const point=polylinePointAt(route.points,.5);
  const badge=el("g",{"data-route-diagnostic":edge.id,role:"img",
    "aria-label":routingDiagnosticLabel(diagnostic),"pointer-events":"none"},group);
  el("circle",{cx:point.x,cy:point.y,r:7,fill:"#FFF7E6",stroke:"#B45309","stroke-width":1.4},badge);
  el("text",{x:point.x,y:point.y+3.5,"text-anchor":"middle",fill:"#92400E",
    "font-family":"Archivo, sans-serif","font-size":10,"font-weight":800},badge).textContent="!";
  el("title",{},badge).textContent=routingDiagnosticLabel(diagnostic);
}
function routingBundleGroups(){
  const groups=new Map();
  for(const edge of state.edges||[]){
    if(!edge.bundleId)continue;
    const key=String(edge.bundleId);
    const list=groups.get(key)||[];list.push(edge);groups.set(key,list);
  }
  for(const [key,list] of [...groups])
    if(list.length<2)groups.delete(key);else list.sort((a,b)=>String(a.id).localeCompare(String(b.id)));
  return groups;
}
function routingBundleCompatible(edges){
  if(!edges||edges.length<2)return false;
  const commonFrom=edges.every(edge=>edge.from===edges[0].from);
  const commonTo=edges.every(edge=>edge.to===edges[0].to);
  if(!commonFrom&&!commonTo)return false;
  const directions=new Set(edges.map(edge=>`${edge.from}:${edge.to}`));
  return commonFrom||commonTo||directions.size===1;
}
function routingSetBundle(edges,bundleId=null,opts={}){
  const targets=(edges||[]).filter(Boolean);
  if(targets.length<2||!routingBundleCompatible(targets)){
    announce("Select at least two compatible links that share a source or destination.");
    return false;
  }
  if(opts.history!==false)pushHistory();
  const id=bundleId||routingId("bundle");
  for(const edge of targets)edge.bundleId=id;
  render();announce(`Bundled ${targets.length} links without merging their relationships.`);
  return id;
}
function routingRemoveBundle(edges,opts={}){
  const targets=(edges||[]).filter(edge=>edge&&edge.bundleId);
  if(!targets.length)return false;
  if(opts.history!==false)pushHistory();
  for(const edge of targets)delete edge.bundleId;
  render();return true;
}
function routingDrawBundleOverlays(){
  for(const [bundleId,edges] of routingBundleGroups()){
    const expanded=routingExpandedBundles.has(bundleId)||
      edges.some(edge=>isSelected("edge",edge.id));
    const routes=edges.map(edge=>routingPolylineForEdge(edge)).filter(Boolean);
    if(routes.length<2)continue;
    const starts=routes.map(route=>route.points[1]||route.points[0]);
    const ends=routes.map(route=>route.points[route.points.length-2]||route.points.at(-1));
    const a={x:starts.reduce((n,p)=>n+p.x,0)/starts.length,
      y:starts.reduce((n,p)=>n+p.y,0)/starts.length};
    const b={x:ends.reduce((n,p)=>n+p.x,0)/ends.length,
      y:ends.reduce((n,p)=>n+p.y,0)/ends.length};
    const middle={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
    const color=edgeLineColor(edges[0],themeColors());
    const group=el("g",{"data-route-bundle":bundleId,role:"button",tabindex:0,
      "aria-label":`${expanded?"Collapse":"Expand"} bundle of ${edges.length} links`,cursor:"pointer"},draftLayer);
    const d=`M ${pathNumber(a.x)} ${pathNumber(a.y)} L ${pathNumber(b.x)} ${pathNumber(b.y)}`;
    el("path",{d,fill:"none",stroke:themeColors().panel,"stroke-width":8,
      "stroke-linecap":"round","pointer-events":"none",opacity:expanded ? .35 : 1},group);
    el("path",{d,fill:"none",stroke:color,"stroke-width":3.2,
      "stroke-linecap":"round","pointer-events":"none",opacity:expanded ? .28 : 1,
      "stroke-dasharray":expanded?"5 5":""},group);
    el("circle",{cx:middle.x,cy:middle.y,r:10,fill:themeColors().panel,
      stroke:color,"stroke-width":1.5},group);
    el("text",{x:middle.x,y:middle.y+3.5,"text-anchor":"middle",fill:color,
      "font-family":"'IBM Plex Mono', monospace","font-size":9.5,"font-weight":700},
      group).textContent=expanded?"−":String(edges.length);
    el("title",{},group).textContent=`Click to ${expanded?"collapse":"expand"} this view-only bundle`;
    group.addEventListener("click",event=>{
      event.stopPropagation();
      if(routingExpandedBundles.has(bundleId))routingExpandedBundles.delete(bundleId);
      else routingExpandedBundles.add(bundleId);
      render();
    });
    group.addEventListener("keydown",event=>{
      if(event.key!=="Enter"&&event.key!==" ")return;
      event.preventDefault();event.stopPropagation();group.dispatchEvent(new Event("click"));
    });
  }
}
function routingUniqueJunctions(){
  const records=new Map();
  for(const edge of state.edges||[])for(const raw of edge.routeJunctions||[]){
    const junction=routingCleanJunction(raw,0);
    if(!junction)continue;
    const record=records.get(junction.id)||{junction,edgeIds:[]};
    record.edgeIds.push(edge.id);records.set(junction.id,record);
  }
  return [...records.values()].sort((a,b)=>a.junction.id.localeCompare(b.junction.id));
}
function routingAddJunction(edges,kind="junction",point=null,opts={}){
  const targets=(edges||[]).filter(Boolean);
  if(!targets.length)return null;
  if(opts.history!==false)pushHistory();
  const id=routingId(kind==="bus"?"bus":"junction");
  const first=targets[0],ep=edgeEndpoints(first);
  const route=ep?orthoEdgeRoute({...first,routing:"ortho"},ep.pa,ep.pb):null;
  const target=point||route&&polylinePointAt(route.points,.5)||{x:0,y:0};
  const junction={id,x:Math.round(target.x),y:Math.round(target.y),kind,
    order:0,...(kind==="bus"?{orientation:"horizontal",length:96}:{})};
  for(const edge of targets){
    edge.routing="ortho";
    edge.routeJunctions=[...(edge.routeJunctions||[]),routingClone(junction)];
    edge.routeMode="constrained";delete edge.routePoints;delete edge.routeDiagnostic;
  }
  render();announce(`Added a ${kind} view constraint to ${targets.length} relationship${targets.length===1?"":"s"}.`);
  return junction;
}
function routingMoveJunction(id,point,opts={}){
  const targets=(state.edges||[]).filter(edge=>(edge.routeJunctions||[]).some(item=>item.id===id));
  if(!targets.length)return false;
  if(opts.history!==false)pushHistory(`route-junction:${id}`);
  for(const edge of targets){
    for(const junction of edge.routeJunctions)
      if(junction.id===id){junction.x=point.x;junction.y=point.y;}
    delete edge.routePoints;delete edge.routeDiagnostic;
  }
  if(opts.render!==false)render();
  return true;
}
function routingRemoveJunction(id,opts={}){
  const targets=(state.edges||[]).filter(edge=>(edge.routeJunctions||[]).some(item=>item.id===id));
  if(!targets.length)return false;
  if(opts.history!==false)pushHistory();
  for(const edge of targets){
    edge.routeJunctions=edge.routeJunctions.filter(item=>item.id!==id);
    if(!edge.routeJunctions.length)delete edge.routeJunctions;
    if(routingRouteMode(edge)==="constrained"&&!(edge.routeWaypoints||[]).length)
      delete edge.routeMode;
    delete edge.routePoints;delete edge.routeDiagnostic;
  }
  render();announce("Removed the view junction; underlying relationships were preserved.");
  return true;
}
function routingDrawJunctionOverlays(){
  const t=themeColors();
  for(const {junction,edgeIds} of routingUniqueJunctions()){
    const selected=edgeIds.some(id=>isSelected("edge",id));
    const group=el("g",{"data-route-junction":junction.id,
      "data-route-junction-kind":junction.kind,cursor:"move",role:"button",tabindex:0,
      "aria-label":`${junction.kind==="bus"?"Bus":"Junction"} at ${Math.round(junction.x)}, `+
        `${Math.round(junction.y)} for ${edgeIds.length} relationship${edgeIds.length===1?"":"s"}`},
      draftLayer);
    if(junction.kind==="bus"){
      const horizontal=junction.orientation!=="vertical",half=junction.length/2;
      el("line",{x1:junction.x-(horizontal?half:0),y1:junction.y-(horizontal?0:half),
        x2:junction.x+(horizontal?half:0),y2:junction.y+(horizontal?0:half),
        stroke:selected?t.accent:t.ink,"stroke-width":5,"stroke-linecap":"round"},group);
    }else{
      el("circle",{cx:junction.x,cy:junction.y,r:7,fill:t.panel,
        stroke:selected?t.accent:t.ink,"stroke-width":2},group);
      el("circle",{cx:junction.x,cy:junction.y,r:2.5,fill:selected?t.accent:t.ink},group);
    }
    el("title",{},group).textContent="Drag to move. Press Delete to remove the view constraint.";
    group.addEventListener("keydown",event=>{
      if(event.key==="Delete"||event.key==="Backspace"){
        event.preventDefault();event.stopPropagation();routingRemoveJunction(junction.id);
        return;
      }
      const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
      if(!delta)return;
      event.preventDefault();event.stopPropagation();
      const step=event.shiftKey?(typeof editingGridSize==="function"?editingGridSize():GRID_SNAP)/2:4;
      routingMoveJunction(junction.id,{
        x:junction.x+delta[0]*step,y:junction.y+delta[1]*step
      });
    });
  }
}
function routingDrawOverlays(){
  routingDrawBundleOverlays();
  routingDrawJunctionOverlays();
  if(typeof routingDrawPreviewOverlay==="function")routingDrawPreviewOverlay();
}

/* -------------------------- Preview jobs -------------------------- */

const ROUTING_DOCUMENT_KEYS=Object.freeze([
  "routing","routeMode","routeAlgorithm","routeVersion","routePoints",
  "routeWaypoints","routeJunctions","routeClearance","routeStability",
  "routeChecksum","routeDiagnostic","orthoX","orthoY","orthoFromStub","orthoToStub"
]);
function routingDocumentDigest(){
  return typeof serializeDocument==="function"
    ?serializeDocument({includeHistory:false}):JSON.stringify({nodes:state.nodes,edges:state.edges});
}
function routingEdgeRouteStats(edge,route){
  const points=route&&route.points||[];
  return {
    length:Math.round(routingPathLength(points)),
    turns:routingTurnCount(points),
    collisions:routingPathCollisions(points,routingObstacleRects(edge)).length,
    signature:routingPathSignature(points)
  };
}
function routingProposeEdge(edge,opts={}){
  const ep=edgeEndpoints(edge);
  if(!ep)return {edgeId:edge.id,status:"failed",diagnostic:routingDiagnostic(
    "missing-endpoint","One or both edge endpoints are not visible.")};
  const before=orthoEdgeRoute(edge,ep.pa,ep.pb);
  const candidate=routingClone(edge);
  candidate.routing="ortho";
  if(opts.reset){
    for(const key of ["routeMode","routePoints","routeWaypoints","routeJunctions",
      "routeDiagnostic","orthoX","orthoY","orthoFromStub","orthoToStub"])delete candidate[key];
  }
  const after=routingResolveOrthoRoute(candidate,ep.pa,ep.pb,{force:true,preview:true})||
    (typeof legacyOrthoEdgeRoute==="function"?legacyOrthoEdgeRoute(candidate,ep.pa,ep.pb):
      orthoEdgeRoute(candidate,ep.pa,ep.pb));
  const beforeStats=routingEdgeRouteStats(edge,before),afterStats=routingEdgeRouteStats(candidate,after);
  routingStoreResolvedRoute(candidate,after,opts.reset?"automatic":routingRouteMode(candidate),
    {resetConstraints:opts.reset});
  const diagnostic=after.diagnostic||null;
  const ownershipChanged=opts.reset&&[
    "routeMode","routePoints","routeWaypoints","routeJunctions",
    "orthoX","orthoY","orthoFromStub","orthoToStub"
  ].some(key=>Object.hasOwn(edge,key));
  return {
    edgeId:edge.id,status:diagnostic?"failed":
      beforeStats.signature===afterStats.signature&&!ownershipChanged?"unchanged":"changed",
    before:routingClone(before.points),after:routingClone(after.points),
    beforeStats,afterStats,diagnostic,
    routePatch:Object.fromEntries(ROUTING_DOCUMENT_KEYS
      .filter(key=>Object.hasOwn(candidate,key)).map(key=>[key,routingClone(candidate[key])])),
    removed:ROUTING_DOCUMENT_KEYS.filter(key=>!Object.hasOwn(candidate,key))
  };
}
function routingPreviewSummary(proposals){
  const counts={changed:0,unchanged:0,failed:0,skipped:0};
  let turns=0,length=0,collisions=0;
  for(const proposal of proposals){
    counts[proposal.status]=(counts[proposal.status]||0)+1;
    if(proposal.afterStats&&proposal.beforeStats){
      turns+=proposal.afterStats.turns-proposal.beforeStats.turns;
      length+=proposal.afterStats.length-proposal.beforeStats.length;
      collisions+=proposal.afterStats.collisions-proposal.beforeStats.collisions;
    }
  }
  return {counts,turns,length,collisions};
}
function routingEnsurePreviewModal(){
  let modal=document.getElementById("routingPreview");
  if(modal)return modal;
  modal=document.createElement("div");
  modal.id="routingPreview";modal.className="modal routing-preview-modal";modal.hidden=true;
  modal.setAttribute("role","dialog");modal.setAttribute("aria-modal","true");
  modal.setAttribute("aria-labelledby","routingPreviewTitle");
  modal.innerHTML=`<div class="card routing-preview-card">
    <h3 id="routingPreviewTitle">Route preview</h3>
    <div class="routing-preview-body">
      <div id="routingPreviewSummary" class="routing-preview-summary"></div>
      <div id="routingPreviewList" class="routing-preview-list" role="list"></div>
    </div>
    <div class="actions">
      <button type="button" id="routingPreviewCancel">Cancel</button>
      <button type="button" id="routingPreviewApply" class="primary">Apply routes</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  modal.querySelector("#routingPreviewCancel").addEventListener("click",routingCancelPreview);
  modal.querySelector("#routingPreviewApply").addEventListener("click",routingApplyPreview);
  modal.addEventListener("pointerdown",event=>{
    if(event.target===modal)routingCancelPreview();
  });
  return modal;
}
function routingRenderPreviewModal(){
  const modal=routingEnsurePreviewModal();
  if(!routingPreview){modal.classList.remove("open");modal.hidden=true;return;}
  const summary=routingPreviewSummary(routingPreview.proposals);
  const summaryEl=modal.querySelector("#routingPreviewSummary");
  summaryEl.innerHTML="";
  for(const [key,label] of [["changed","Changed"],["unchanged","Unchanged"],
    ["failed","Failed"],["skipped","Skipped"]]){
    const item=document.createElement("div");
    item.className=`routing-preview-stat ${key}`;
    item.innerHTML=`<strong>${summary.counts[key]||0}</strong><span>${label}</span>`;
    summaryEl.appendChild(item);
  }
  const delta=document.createElement("div");
  delta.className="helper routing-preview-delta";
  const progress=routingPreview.status==="computing"
    ?`Calculating ${routingPreview.proposals.length} of ${routingPreview.edgeIds.length} links… `
    :"";
  delta.textContent=progress+`Turns ${summary.turns>=0?"+":""}${summary.turns}; length `+
    `${summary.length>=0?"+":""}${summary.length}px; collisions `+
    `${summary.collisions>=0?"+":""}${summary.collisions}. Nodes and relationship semantics will not change.`;
  summaryEl.appendChild(delta);
  const list=modal.querySelector("#routingPreviewList");list.innerHTML="";
  for(const proposal of routingPreview.proposals){
    const edge=edgeById(proposal.edgeId);
    const from=edge&&nodeById(edge.from),to=edge&&nodeById(edge.to);
    const row=document.createElement("div");
    row.className=`routing-preview-row ${proposal.status}`;row.setAttribute("role","listitem");
    const title=document.createElement("strong");
    title.textContent=`${from?.title||edge?.from||"?"} → ${to?.title||edge?.to||"?"}`;
    const detail=document.createElement("span");
    detail.textContent=proposal.diagnostic?.message||
      (proposal.status==="changed"
        ?`${proposal.beforeStats.turns} → ${proposal.afterStats.turns} turns; `+
          `${proposal.beforeStats.length} → ${proposal.afterStats.length}px`
        :proposal.status==="unchanged"?"Already has a stable valid route":"Skipped");
    row.append(title,detail);list.appendChild(row);
  }
  modal.querySelector("#routingPreviewApply").disabled=routingPreview.status==="computing"||
    !routingPreview.proposals.some(item=>item.status==="changed");
  modal.hidden=false;modal.classList.add("open");
  requestAnimationFrame(()=>modal.querySelector("#routingPreviewCancel")?.focus());
}
function routingOpenPreview(edgeIds,opts={}){
  const ids=[...new Set((edgeIds||[]).map(String))];
  const edges=ids.map(edgeById).filter(Boolean);
  if(!edges.length){announce("No links are available in this routing scope.");return false;}
  const started=performance.now();
  const beforeDigest=routingDocumentDigest();
  const generation=routingGeneration;
  routingPreview={
    id:routingTransientId("route-preview"),generation,beforeDigest,
    edgeIds:ids,proposals:[],opts:routingClone(opts),selection:routingClone(selectionIds()),
    camera:{...view},createdAt:Date.now(),elapsed:performance.now()-started
  };
  const token=routingPreview.id;
  const propose=edge=>routingRouteMode(edge)==="locked"&&!opts.includeLocked&&!opts.reset
    ?{edgeId:edge.id,status:"skipped",diagnostic:routingDiagnostic("locked","Locked route skipped.")}
    :routingProposeEdge(edge,opts);
  if(edges.length<=30){
    routingPreview.proposals=edges.map(propose);
    routingPreview.status="ready";
    routingPreview.elapsed=performance.now()-started;
    routingRenderPreviewModal();render();
  }else{
    routingPreview.status="computing";
    routingRenderPreviewModal();render();
    routingRunPreviewBatch(token,edges,propose,0,started);
  }
  return routingPreview;
}
function routingRunPreviewBatch(token,edges,propose,index,started){
  if(!routingPreview||routingPreview.id!==token)return;
  const batchEnd=Math.min(edges.length,index+18);
  for(let cursor=index;cursor<batchEnd;cursor++){
    if(!routingPreview||routingPreview.id!==token)return;
    routingPreview.proposals.push(propose(edges[cursor]));
  }
  routingRenderPreviewModal();
  if(batchEnd<edges.length){
    setTimeout(()=>routingRunPreviewBatch(token,edges,propose,batchEnd,started),0);
    return;
  }
  routingPreview.status="ready";
  routingPreview.elapsed=performance.now()-started;
  routingRenderPreviewModal();render();
  announce(`Routing preview ready in ${Math.round(routingPreview.elapsed)} ms.`);
}
function routingCancelPreview(){
  if(!routingPreview)return false;
  const modal=routingEnsurePreviewModal();
  const digest=routingDocumentDigest();
  const intact=digest===routingPreview.beforeDigest;
  routingPreview=null;modal.classList.remove("open");modal.hidden=true;render();
  announce(intact?"Route preview canceled. The document was not changed.":
    "Preview canceled; a separate document change occurred while it was open.");
  return intact;
}
function routingApplyPreview(){
  if(!routingPreview)return false;
  if(routingPreview.beforeDigest!==routingDocumentDigest()){
    const edgeIds=routingPreview.edgeIds,opts=routingPreview.opts;
    routingPreview=null;
    announce("Geometry changed. Recomputed the stale routing proposal.");
    return routingOpenPreview(edgeIds,opts);
  }
  const changed=routingPreview.proposals.filter(item=>item.status==="changed");
  if(!changed.length)return routingCancelPreview();
  pushHistory();
  for(const proposal of changed){
    const edge=edgeById(proposal.edgeId);
    if(!edge)continue;
    for(const key of proposal.removed||[])delete edge[key];
    for(const [key,value] of Object.entries(proposal.routePatch||{}))edge[key]=routingClone(value);
  }
  const count=changed.length;
  routingPreview=null;
  const modal=routingEnsurePreviewModal();modal.classList.remove("open");modal.hidden=true;
  render();announce(`Applied ${count} route change${count===1?"":"s"} as one undoable operation.`);
  return true;
}
function routingDrawPreviewOverlay(){
  if(!routingPreview)return;
  for(const proposal of routingPreview.proposals){
    if(proposal.status!=="changed"||!proposal.after?.length)continue;
    const edge=edgeById(proposal.edgeId),color=edge?edgeLineColor(edge,themeColors()):themeColors().accent;
    const beforeD=squarePolylinePath(proposal.before);
    const afterD=squarePolylinePath(proposal.after);
    el("path",{d:beforeD,fill:"none",stroke:"#C20029","stroke-width":2,
      "stroke-dasharray":"4 4",opacity:.46,"pointer-events":"none",
      "data-route-preview-before":proposal.edgeId},draftLayer);
    el("path",{d:afterD,fill:"none",stroke:color,"stroke-width":3,
      opacity:.88,"pointer-events":"none","data-route-preview-after":proposal.edgeId},draftLayer);
  }
}

/* ----------------------- Scope and lifecycle ---------------------- */

function routingSelectedEdges(){
  return selectionIds("edge").map(edgeById).filter(Boolean);
}
function routingEdgesAttachedToNodes(nodes){
  const ids=new Set((nodes||[]).map(node=>node.id));
  return (state.edges||[]).filter(edge=>ids.has(edge.from)||ids.has(edge.to));
}
function routingEdgesInsideFrame(frame){
  if(!frame||frame.type!=="frame")return[];
  const fr=nodeRect(frame),inside=new Set((state.nodes||[]).filter(node=>{
    if(node===frame)return false;
    const r=nodeRect(node);
    return r.x>=fr.x&&r.y>=fr.y&&r.x+r.w<=fr.x+fr.w&&r.y+r.h<=fr.y+fr.h;
  }).map(node=>node.id));
  return (state.edges||[]).filter(edge=>inside.has(edge.from)&&inside.has(edge.to));
}
function routingScopeEdges(scope="selection"){
  if(scope==="selection"){
    const direct=routingSelectedEdges();
    return direct.length?direct:routingEdgesAttachedToNodes(selectedNodes());
  }
  if(scope==="attached")return routingEdgesAttachedToNodes(selectedNodes());
  if(scope==="frame"){
    const frame=selectedNodes().find(node=>node.type==="frame");
    return routingEdgesInsideFrame(frame);
  }
  return (typeof visibleCanvasEdges==="function"?visibleCanvasEdges():state.edges).filter(Boolean);
}
function routingCommitAffectedNodeMove(nodeIds,beforeRects=[]){
  const ids=new Set(nodeIds||[]);
  if(!ids.size)return 0;
  const bothMoved=edge=>ids.has(edge.from)&&ids.has(edge.to);
  const movedObstacles=(nodeIds||[]).map(nodeById).filter(Boolean)
    .map(node=>routingNodeObstacle(node,ROUTING_DEFAULT_CLEARANCE)).filter(Boolean);
  let changed=0;
  for(const edge of state.edges||[]){
    const attached=ids.has(edge.from)||ids.has(edge.to);
    if(edge.routing!=="ortho")continue;
    let newlyObstructed=false;
    if(!attached&&movedObstacles.length){
      const ep=edgeEndpoints(edge);
      if(ep){
        const stored=routingNormalizePoints(edge.routePoints);
        const current=stored.length
          ?routingOrthogonalize([ep.pa,...stored,ep.pb])
          :(typeof legacyOrthoEdgeRoute==="function"
            ?legacyOrthoEdgeRoute(edge,ep.pa,ep.pb).points:[]);
        newlyObstructed=routingPathCollisions(current,movedObstacles).length>0;
      }
    }
    if(!attached&&!newlyObstructed)continue;
    if(bothMoved(edge)&&Array.isArray(edge.routePoints)){
      const before=beforeRects.find(item=>item.id===edge.from);
      const after=nodeById(edge.from);
      if(before&&after){
        const dx=after.x-before.x,dy=after.y-before.y;
        edge.routePoints=edge.routePoints.map(point=>({...point,x:point.x+dx,y:point.y+dy}));
        if(Array.isArray(edge.routeWaypoints))
          edge.routeWaypoints=edge.routeWaypoints.map(point=>({...point,x:point.x+dx,y:point.y+dy}));
        if(Array.isArray(edge.routeJunctions))
          edge.routeJunctions=edge.routeJunctions.map(point=>({...point,x:point.x+dx,y:point.y+dy}));
        changed++;
      }
      continue;
    }
    const mode=routingRouteMode(edge);
    if(mode==="locked"||mode==="manual")continue;
    const ep=edgeEndpoints(edge);
    if(!ep)continue;
    const route=routingResolveOrthoRoute(edge,ep.pa,ep.pb,{force:true});
    if(!route)continue;
    if(route.diagnostic){
      edge.routeDiagnostic=routingClone(route.diagnostic);
      continue;
    }
    routingStoreResolvedRoute(edge,route,mode);
    changed++;
  }
  return changed;
}

/* ---------------------- Semantic edge editing -------------------- */

function routingReverseStoredGeometry(edge){
  if(Array.isArray(edge.routePoints))edge.routePoints=[...edge.routePoints].reverse();
  if(Array.isArray(edge.routeWaypoints))
    edge.routeWaypoints=[...edge.routeWaypoints].reverse().map((point,index)=>({...point,order:index}));
  if(Array.isArray(edge.routeJunctions))
    edge.routeJunctions=[...edge.routeJunctions].reverse().map((point,index)=>({...point,order:index}));
  if(Number.isFinite(Number(edge.labelOffset)))edge.labelOffset=-Number(edge.labelOffset);
}
function routingReverseDirection(edge,opts={}){
  if(!edge)return false;
  if(opts.history!==false)pushHistory();
  const start=edge.startArrow===true,end=edge.endArrow===true;
  swapEdgeDirection(edge);routingReverseStoredGeometry(edge);
  if(end)edge.startArrow=true;else delete edge.startArrow;
  if(start)edge.endArrow=true;else delete edge.endArrow;
  if(opts.render!==false)render();
  return true;
}
function routingSwapEndpoints(edge,opts={}){
  if(!edge)return false;
  if(opts.history!==false)pushHistory();
  const start=edge.startArrow===true,end=edge.endArrow===true;
  swapEdgeDirection(edge);routingReverseStoredGeometry(edge);
  if(start)edge.startArrow=true;else delete edge.startArrow;
  if(end)edge.endArrow=true;else delete edge.endArrow;
  if(opts.render!==false)render();
  return true;
}
function routingApplyRelationshipType(edges,value,opts={}){
  const targets=(edges||[]).filter(Boolean);
  if(!targets.length)return false;
  if(opts.history!==false)pushHistory();
  for(const edge of targets){
    if(["link","1:1","1:N","N:M"].includes(value))edge.kind=value;
    else{edge.kind="link";edge.label=String(value||"");}
  }
  render();return true;
}
function routingCopyEdgeForSplit(edge){
  const copy=routingClone(edge);
  copy.id=uid();
  for(const key of ["relationshipId","routePoints","routeChecksum","routeDiagnostic",
    "routeWaypoints","routeJunctions","routeMode","routeAlgorithm","routeVersion"])delete copy[key];
  return copy;
}
function routingInsertNode(edge,point=null,opts={}){
  if(!edge)return false;
  const ep=edgeEndpoints(edge);
  if(!ep)return false;
  const route=edge.routing==="ortho"?orthoEdgeRoute(edge,ep.pa,ep.pb):null;
  const target=point||route&&polylinePointAt(route.points,.5)||
    {x:(ep.pa.x+ep.pb.x)/2,y:(ep.pa.y+ep.pb.y)/2};
  const title=opts.title||"Inserted step";
  const before=`Insert “${title}” into ${nodeById(edge.from)?.title||edge.from} → `+
    `${nodeById(edge.to)?.title||edge.to}. This creates two relationships and preserves the original link's label, style, markers, and metadata on both copies.`;
  if(opts.confirm!==false&&!window.confirm(before))return false;
  pushHistory();
  const node={id:uid(),type:"concept",x:target.x-70,y:target.y-32,title,notes:"",
    color:conceptColors()[state.nodes.filter(item=>item.type==="concept").length%conceptColors().length]};
  if(typeof organizationAssignActiveLayer==="function")organizationAssignActiveLayer(node);
  const second=routingCopyEdgeForSplit(edge),originalTo=edge.to;
  edge.to=node.id;delete edge.toField;delete edge.toPort;delete edge.pairs;edge.toAnchor="ml";
  second.from=node.id;second.to=originalTo;
  delete second.fromField;delete second.fromPort;delete second.pairs;second.fromAnchor="mr";
  state.nodes.push(node);state.edges.push(second);setSelection("node",node.id);render();
  announce("Inserted one node and split the relationship in one undoable transaction.");
  return node;
}
function routingSplitAtJunction(edge,point=null){
  if(!edge)return false;
  return routingAddJunction([edge],"junction",point);
}

/* ---------------------- Typed-port compatibility ----------------- */

const ROUTING_PORT_COMPATIBILITY=Object.freeze({
  data:new Set(["data","read","write","input","output","api"]),
  control:new Set(["control","event","input","output"]),
  event:new Set(["event","control","input"]),
  api:new Set(["api","data","read","write","input","output","authentication","error"]),
  read:new Set(["data","read","output","api"]),
  write:new Set(["data","write","input","api"]),
  input:new Set(["data","control","event","api","read","write","input","output","error","authentication"]),
  output:new Set(["data","control","event","api","read","write","input","output","error","authentication"]),
  error:new Set(["error","event","input"]),
  authentication:new Set(["authentication","api","input"])
});
function routingPortDefinition(node,portId,preferredSide=null){
  if(!node||!portId||!nodePortsEnabled(node))return null;
  const sides=preferredSide?[preferredSide,preferredSide==="input"?"output":"input"]:["input","output"];
  for(const side of sides){
    const port=nodePortsForSide(node,side).find(item=>item.id===portId);
    if(port)return{...port,side};
  }
  return null;
}
function routingPortType(port){
  const type=String(port&&port.type||"").trim().toLowerCase();
  return ROUTING_PORT_TYPES.some(item=>item[0]===type)?type:"";
}
function routingPortCompatibility(fromNode,fromPortId,toNode,toPortId,relationship="link"){
  const from=routingPortDefinition(fromNode,fromPortId,"output");
  const to=routingPortDefinition(toNode,toPortId,"input");
  if(!from||!to)return{
    compatible:true,severity:"untyped",reason:"One or both endpoints use an untyped or whole-node connection.",
    from,to
  };
  if(from.side!=="output"||to.side!=="input")return{
    compatible:false,severity:"error",from,to,
    reason:`Connections must run from an output to an input; this uses `+
      `${from.label} as ${from.side} and ${to.label} as ${to.side}.`
  };
  const fromType=routingPortType(from),toType=routingPortType(to);
  if(!fromType||!toType)return{
    compatible:true,severity:"untyped",from,to,
    reason:"Untyped ports remain compatible for legacy documents."
  };
  const relationshipAllowed=port=>{
    const list=Array.isArray(port.allowedRelationships)?port.allowedRelationships.map(String):[];
    return !list.length||list.includes(relationship);
  };
  if(!relationshipAllowed(from)||!relationshipAllowed(to))return{
    compatible:false,severity:"error",from,to,
    reason:`The ${relationship} relationship is not allowed by one of these ports.`
  };
  const compatible=fromType===toType||
    ROUTING_PORT_COMPATIBILITY[fromType]?.has(toType)||
    ROUTING_PORT_COMPATIBILITY[toType]?.has(fromType);
  return{
    compatible:!!compatible,severity:compatible?"compatible":"warning",from,to,
    reason:compatible?`${from.label} (${fromType}) is compatible with ${to.label} (${toType}).`:
      `${from.label} (${fromType}) is not normally compatible with ${to.label} (${toType}).`
  };
}
function routingConnectionCompatibility(from,to,kind="link"){
  const fromNode=nodeById(from&&from.id),toNode=nodeById(to&&to.id);
  return routingPortCompatibility(fromNode,from&&from.portId,toNode,to&&to.portId,kind);
}
function routingApproveConnection(from,to,kind="link"){
  const result=routingConnectionCompatibility(from,to,kind);
  if(result.compatible)return{allowed:true,override:false,result};
  const allowed=window.confirm(`${result.reason}\n\nCreate this connection as an explicit compatibility exception?`);
  return{allowed,override:allowed,result};
}
function routingUpdateEdgePortDiagnostic(edge){
  if(!edge)return null;
  const fromNode=nodeById(edge.from),toNode=nodeById(edge.to);
  const from=edge.fromPort?routingPortDefinition(fromNode,edge.fromPort,"output"):null;
  const to=edge.toPort?routingPortDefinition(toNode,edge.toPort,"input"):null;
  if(edge.fromPort&&!from||edge.toPort&&!to){
    const missing=[];
    if(edge.fromPort&&!from)missing.push(`${fromNode?.title||edge.from}.${edge.fromPort}`);
    if(edge.toPort&&!to)missing.push(`${toNode?.title||edge.to}.${edge.toPort}`);
    const diagnostic=routingDiagnostic("unresolved-port",
      `Unresolved named port: ${missing.join(", ")}. The original binding was preserved.`);
    routingTransientDiagnostics.set(edge.id,diagnostic);
    return diagnostic;
  }
  const result=routingPortCompatibility(fromNode,edge.fromPort,toNode,edge.toPort,edge.kind);
  if(!result.compatible){
    const diagnostic=routingDiagnostic("port-incompatible",
      edge.portCompatibilityOverride?`Compatibility exception: ${result.reason}`:result.reason);
    routingTransientDiagnostics.set(edge.id,diagnostic);
    return diagnostic;
  }
  const existing=routingTransientDiagnostics.get(edge.id);
  if(existing&&["unresolved-port","port-incompatible"].includes(existing.code))
    routingTransientDiagnostics.delete(edge.id);
  return null;
}
function routingDropPreviewColor(source,hit,w){
  if(!source||!hit?.node)return"#2456E6";
  let from=source,to=null,kind="link";
  if(source.from&&source.to){
    from=source.from;to=source.to;kind=source.kind||kind;
  }else{
    const anchor=!hit.field?nearestAnchorWithin(hit.node,w):null;
    to={id:hit.node.id,fieldId:hit.field?.id,portId:anchor?.portId};
  }
  const result=routingConnectionCompatibility(from,to,kind);
  return result.compatible?"#007873":"#C20029";
}
function routingPortTypeSelect(node,side,port){
  const select=document.createElement("select");
  select.className="port-type-select";
  select.setAttribute("aria-label",`${port.label} semantic type`);
  for(const [value,label] of ROUTING_PORT_TYPES){
    const option=document.createElement("option");
    option.value=value;option.textContent=label;option.selected=routingPortType(port)===value;
    select.appendChild(option);
  }
  select.addEventListener("change",()=>{
    pushHistory();
    const ports=materializeNodePorts(node,side);
    const target=ports.find(item=>item.id===port.id);
    if(target){
      if(select.value)target.type=select.value;else delete target.type;
      for(const edge of state.edges||[])
        if((edge.from===node.id&&edge.fromPort===port.id)||(edge.to===node.id&&edge.toPort===port.id))
          routingUpdateEdgePortDiagnostic(edge);
    }
    render();
  });
  return select;
}
function routingMovePort(node,side,portId,delta){
  const ports=materializeNodePorts(node,side);
  const index=ports.findIndex(item=>item.id===portId);
  const target=index+delta;
  if(index<0||target<0||target>=ports.length)return false;
  pushHistory();
  const [port]=ports.splice(index,1);ports.splice(target,0,port);
  ports.forEach((item,order)=>{item.order=order;});
  render();return true;
}
function routingPortDetails(node,side,port){
  const wrap=document.createElement("div");wrap.className="port-detail-row";
  wrap.appendChild(routingPortTypeSelect(node,side,port));
  const group=document.createElement("input");
  group.type="text";group.value=port.group||"";group.placeholder="Group";
  group.setAttribute("aria-label",`${port.label} port group`);
  bindHistoryOnInput(group,()=>{
    const target=materializeNodePorts(node,side).find(item=>item.id===port.id);
    if(!target)return;
    const value=group.value.trim().slice(0,60);
    if(value)target.group=value;else delete target.group;
    drawOnly();
  });
  const multiplicity=document.createElement("select");
  multiplicity.setAttribute("aria-label",`${port.label} multiplicity`);
  for(const [value,label] of [["","Any"],["one","One"],["many","Many"]]){
    const option=document.createElement("option");
    option.value=value;option.textContent=label;option.selected=(port.multiplicity||"")===value;
    multiplicity.appendChild(option);
  }
  multiplicity.addEventListener("change",()=>{
    pushHistory();
    const target=materializeNodePorts(node,side).find(item=>item.id===port.id);
    if(target){if(multiplicity.value)target.multiplicity=multiplicity.value;else delete target.multiplicity;}
    render();
  });
  const placement=document.createElement("select");
  placement.setAttribute("aria-label",`${port.label} physical side`);
  for(const [value,label] of [["","Default side"],["left","Left"],["right","Right"]]){
    const option=document.createElement("option");
    option.value=value;option.textContent=label;option.selected=(port.placement||"")===value;
    placement.appendChild(option);
  }
  placement.addEventListener("change",()=>{
    pushHistory();
    const target=materializeNodePorts(node,side).find(item=>item.id===port.id);
    if(target){if(placement.value)target.placement=placement.value;else delete target.placement;}
    render();
  });
  const order=document.createElement("div");order.className="port-order-buttons";
  const ports=nodePortsForSide(node,side),index=ports.findIndex(item=>item.id===port.id);
  const up=mkBtn("↑",()=>routingMovePort(node,side,port.id,-1),"mini");
  const down=mkBtn("↓",()=>routingMovePort(node,side,port.id,1),"mini");
  up.disabled=index<=0;down.disabled=index<0||index>=ports.length-1;
  up.setAttribute("aria-label",`Move ${port.label} earlier`);
  down.setAttribute("aria-label",`Move ${port.label} later`);
  order.append(up,down);
  wrap.append(group,multiplicity,placement,order);
  const allowed=document.createElement("input");
  allowed.type="text";
  allowed.className="port-allowed-relationships";
  allowed.value=Array.isArray(port.allowedRelationships)?port.allowedRelationships.join(", "):"";
  allowed.placeholder="Allowed relationships (optional, comma separated)";
  allowed.setAttribute("aria-label",`${port.label} allowed relationship types`);
  bindHistoryOnInput(allowed,()=>{
    const target=materializeNodePorts(node,side).find(item=>item.id===port.id);
    if(!target)return;
    const values=[...new Set(allowed.value.split(",").map(value=>value.trim()).filter(Boolean))].slice(0,24);
    if(values.length)target.allowedRelationships=values;else delete target.allowedRelationships;
    drawOnly();
  });
  wrap.appendChild(allowed);
  return wrap;
}

/* ------------------------- Inspector UI --------------------------- */

function routingModeSelect(edges){
  const select=document.createElement("select");
  select.setAttribute("aria-label","Route ownership");
  const current=routingRouteMode(edges[0]);
  for(const [value,label] of ROUTING_MODES){
    const option=document.createElement("option");
    option.value=value;option.textContent=label;
    option.selected=edges.every(edge=>routingRouteMode(edge)===current)&&value===current;
    select.appendChild(option);
  }
  select.addEventListener("change",()=>routingSetMode(edges,select.value));
  return select;
}
function routingBridgeSelect(edges){
  const select=document.createElement("select");
  select.setAttribute("aria-label","Crossing bridge treatment");
  const current=edges[0].bridgeMode||"auto";
  for(const [value,label] of [["auto","Automatic"],["over","Always over"],["under","Always under"],["none","No bridges"]]){
    const option=document.createElement("option");
    option.value=value;option.textContent=label;
    option.selected=edges.every(edge=>(edge.bridgeMode||"auto")===current)&&value===current;
    select.appendChild(option);
  }
  select.addEventListener("change",()=>{
    pushHistory();
    for(const edge of edges){
      if(select.value==="auto")delete edge.bridgeMode;else edge.bridgeMode=select.value;
    }
    render();
  });
  return select;
}
function renderRoutingInspectorForEdge(edge){
  inspectorSection("edge:smart-routing","Smart routing",()=>{
    frow("Ownership",()=>routingModeSelect([edge]));
    frow("Clearance",()=>sizeStepper(routingClearance(edge),4,96,2,(value,commit)=>{
      pushHistory(`route-clearance:${edge.id}`);
      if(value===ROUTING_DEFAULT_CLEARANCE)delete edge.routeClearance;else edge.routeClearance=value;
      delete edge.routePoints;
      commit?render():drawOnly();
    },{ariaLabel:"Obstacle clearance"}));
    frow("Stability",()=>{
      const input=document.createElement("input");
      input.type="range";input.min="0";input.max="1";input.step=".05";
      input.value=String(routingStability(edge));
      input.setAttribute("aria-label","Mental-map stability preference");
      bindHistoryOnInput(input,()=>{
        edge.routeStability=Number(input.value);
        delete edge.routePoints;drawOnly();
      });
      return input;
    });
    frow("Crossings",()=>routingBridgeSelect([edge]));
    frow("Label offset",()=>sizeStepper(
      routingClamp(edge.labelOffset,-160,160,0),-160,160,2,(value,commit)=>{
        pushHistory(`route-label-offset:${edge.id}`);
        if(Math.abs(value)<.001)delete edge.labelOffset;else edge.labelOffset=value;
        commit?render():drawOnly();
      },{ariaLabel:"Label normal offset"}));
    const row=document.createElement("div");row.className="rowbtns";
    row.append(
      mkBtn("Preview reroute",()=>routingOpenPreview([edge.id])),
      mkBtn("Add waypoint",()=>routingAddWaypoint(edge))
    );
    appendInspector(row);
    const dense=document.createElement("div");dense.className="rowbtns";
    dense.append(
      mkBtn("Add junction",()=>routingAddJunction([edge])),
      mkBtn("Add bus",()=>routingAddJunction([edge],"bus"))
    );
    appendInspector(dense);
    const diagnostic=routingEdgeDiagnostic(edge)||routingUpdateEdgePortDiagnostic(edge);
    if(diagnostic){
      const warning=document.createElement("div");
      warning.className="helper routing-diagnostic";
      warning.textContent=diagnostic.message;appendInspector(warning);
    }
  },{open:true});
}
function renderRoutingMultiInspector(edges){
  setInspectorHeader("Multiple edges",`${edges.length} links`);
  inspectorSection("multi-edge:routing","Smart routing",()=>{
    frow("Ownership",()=>routingModeSelect(edges));
    frow("Crossings",()=>routingBridgeSelect(edges));
    const row=document.createElement("div");row.className="rowbtns";
    row.append(
      mkBtn("Preview reroute",()=>routingOpenPreview(edges.map(edge=>edge.id))),
      mkBtn("Bundle",()=>routingSetBundle(edges))
    );
    appendInspector(row);
    const relation=document.createElement("select");
    relation.setAttribute("aria-label","Relationship type for selected links");
    for(const value of ["","link","1:1","1:N","N:M",...EDGE_RELATIONSHIPS.map(item=>item[0])]){
      const label=value;
      const option=document.createElement("option");
      option.value=label||"";option.textContent=label||"Apply relationship…";relation.appendChild(option);
    }
    relation.addEventListener("change",()=>{
      if(relation.value)routingApplyRelationshipType(edges,relation.value);
    });
    frow("Relationship",()=>relation);
  });
  inspectorActions([
    mkBtn("Reset routes",()=>routingResetEdges(edges)),
    mkBtn("Remove bundle",()=>routingRemoveBundle(edges))
  ],mkBtn("Delete links",deleteSelection,"dangerbtn"),{inlineDanger:true});
}

/* --------------------- Context and command UI -------------------- */

function buildRoutingEdgeContext(parent,edge){
  const targets=isSelected("edge",edge.id)&&selectionCount("edge")>1
    ?routingSelectedEdges():[edge];
  ctxGroup(parent,"edge:smart-routing","Smart routing",panel=>{
    ctxSubmenu(panel,"edge:smart-routing:mode","Route ownership",sub=>{
      for(const [value,label] of ROUTING_MODES)
        ctxItem(sub,label,()=>routingSetMode(targets,value),
          {pressed:targets.every(item=>routingRouteMode(item)===value),action:`route-mode-${value}`});
    });
    ctxItem(panel,targets.length>1?`Preview ${targets.length} routes…`:"Preview reroute…",
      ()=>routingOpenPreview(targets.map(item=>item.id)),{action:"route-preview"});
    ctxItem(panel,"Reset to automatic…",()=>routingResetEdges(targets),{action:"route-reset"});
    ctxSubmenu(panel,"edge:smart-routing:constraints","Waypoints and structure",sub=>{
      ctxItem(sub,"Add waypoint",()=>routingAddWaypoint(edge),{action:"route-add-waypoint"});
      ctxItem(sub,"Add junction",()=>routingAddJunction(targets),{action:"route-add-junction"});
      ctxItem(sub,"Add bus",()=>routingAddJunction(targets,"bus"),{action:"route-add-bus"});
    });
    ctxSubmenu(panel,"edge:smart-routing:bridges","Crossing bridges",sub=>{
      for(const [value,label] of [["auto","Automatic"],["over","Always over"],["under","Always under"],["none","None"]])
        ctxItem(sub,label,()=>{
          pushHistory();if(value==="auto")delete edge.bridgeMode;else edge.bridgeMode=value;render();
        },{pressed:(edge.bridgeMode||"auto")===value,action:`bridge-${value}`});
    });
    ctxSubmenu(panel,"edge:smart-routing:edit","Semantic editing",sub=>{
      ctxItem(sub,"Reverse direction",()=>routingReverseDirection(edge),{action:"edge-reverse"});
      ctxItem(sub,"Swap endpoints",()=>routingSwapEndpoints(edge),{action:"edge-swap"});
      ctxItem(sub,"Insert node…",()=>routingInsertNode(edge),{action:"edge-insert-node"});
      ctxItem(sub,"Split at junction",()=>routingSplitAtJunction(edge),{action:"edge-split"});
      if(targets.length>1){
        ctxItem(sub,"Bundle selected links",()=>routingSetBundle(targets),{action:"edge-bundle"});
        ctxSubmenu(sub,"edge:smart-routing:relationship","Apply relationship type",types=>{
          for(const value of ["link","1:1","1:N","N:M",...EDGE_RELATIONSHIPS.map(item=>item[0])])
            ctxItem(types,value,()=>routingApplyRelationshipType(targets,value));
        });
      }
    });
  });
}
function buildRoutingNodeContext(parent,node,targets=[]){
  const edges=routingEdgesAttachedToNodes(targets.length?targets:[node]);
  if(!edges.length)return;
  ctxGroup(parent,"node:smart-routing","Attached links",panel=>{
    ctxItem(panel,`Preview reroute (${edges.length})…`,
      ()=>routingOpenPreview(edges.map(edge=>edge.id)),{action:"route-attached-preview"});
    ctxItem(panel,"Reset attached routes…",()=>routingOpenPreview(edges.map(edge=>edge.id),{reset:true}),
      {action:"route-attached-reset"});
    if(node.type==="frame"){
      const inside=routingEdgesInsideFrame(node);
      ctxItem(panel,`Reroute links inside frame (${inside.length})…`,
        ()=>routingOpenPreview(inside.map(edge=>edge.id)),{disabled:!inside.length,action:"route-frame-preview"});
    }
  });
}
function buildRoutingCanvasContext(parent){
  ctxGroup(parent,"canvas:smart-routing","Smart routing",panel=>{
    ctxItem(panel,"Preview page reroute…",
      ()=>routingOpenPreview(routingScopeEdges("page").map(edge=>edge.id)),{action:"route-page-preview"});
    ctxItem(panel,"Routing benchmark…",routingRunBenchmark,{action:"route-benchmark"});
  });
}
function routingCommandEdges(){return routingScopeEdges("selection");}
function initializeRoutingCommands(){
  const commands=[
    {id:"routePreview",label:"Preview reroute",description:"Preview smart routes for selected or attached links",
      action:()=>routingOpenPreview(routingCommandEdges().map(edge=>edge.id)),
      enabled:()=>routingCommandEdges().length>0,ribbon:{tab:"arrange",group:"Routing"},icon:"lucide:route"},
    {id:"routePagePreview",label:"Route page",description:"Preview smart routes for every visible link",
      action:()=>routingOpenPreview(routingScopeEdges("page").map(edge=>edge.id)),
      enabled:()=>state.edges.length>0,ribbon:{tab:"arrange",group:"Routing"},icon:"lucide:git-branch"},
    {id:"routeLock",label:"Lock route",description:"Preserve selected intermediate route geometry",
      action:()=>routingSetMode(routingCommandEdges(),"locked"),
      enabled:()=>routingCommandEdges().length>0},
    {id:"routeUnlock",label:"Unlock route",description:"Return selected routes to automatic ownership",
      action:()=>routingSetMode(routingCommandEdges(),"automatic"),
      enabled:()=>routingCommandEdges().some(edge=>routingRouteMode(edge)==="locked")},
    {id:"routeReset",label:"Reset routes",description:"Preview removal of manual route constraints",
      action:()=>routingResetEdges(routingCommandEdges()),
      enabled:()=>routingCommandEdges().length>0},
    {id:"routeBenchmark",label:"Routing benchmark",description:"Measure deterministic ordinary and dense routing fixtures",
      action:routingRunBenchmark,ribbon:{tab:"arrange",group:"Routing",priority:"low"}}
  ];
  for(const command of commands)registerCommand({...command,owner:"routing"},{owner:"routing"});
}
function initializeRoutingUi(){
  routingEnsurePreviewModal();
}

/* -------------------------- Benchmarks ---------------------------- */

function routingBenchmarkFixture(nodeCount=500,edgeCount=1000){
  const nodes=[];
  const columns=Math.max(10,Math.ceil(Math.sqrt(nodeCount*1.6)));
  for(let index=0;index<nodeCount;index++)
    nodes.push({id:`bench-n-${index}`,type:"concept",x:(index%columns)*118,
      y:Math.floor(index/columns)*84,title:`N${index}`,w:86,h:48});
  const edges=[];
  for(let index=0;index<edgeCount;index++){
    const from=index%nodeCount;
    const stride=1+((index*17)%Math.max(2,Math.min(nodeCount-1,columns*3)));
    const to=(from+stride)%nodeCount;
    edges.push({id:`bench-e-${index}`,from:nodes[from].id,to:nodes[to].id,
      kind:"link",routing:"ortho"});
  }
  return{nodes,edges};
}
function routingBenchmarkCase(nodeCount,edgeCount,sampleLimit=300){
  const fixture=routingBenchmarkFixture(nodeCount,edgeCount);
  const byId=new Map(fixture.nodes.map(node=>[node.id,node]));
  const started=performance.now();
  let routed=0,failed=0,turns=0;
  for(const edge of fixture.edges.slice(0,sampleLimit)){
    const a=byId.get(edge.from),b=byId.get(edge.to);
    const pa={x:a.x+86,y:a.y+24,side:"e"},pb={x:b.x,y:b.y+24,side:"w"};
    const obstacles=fixture.nodes.filter(node=>node.id!==a.id&&node.id!==b.id)
      .map(node=>({id:node.id,x:node.x-12,y:node.y-12,w:110,h:72}));
    const result=routingFindPath(routingEndpointStub(pa,12),routingEndpointStub(pb,12),obstacles,{
      stability:ROUTING_DEFAULT_STABILITY
    });
    if(result.ok){routed++;turns+=routingTurnCount(result.points);}else failed++;
  }
  const sampleMs=performance.now()-started;
  const incrementalStarted=performance.now();
  const incrementalEdge=fixture.edges[Math.min(fixture.edges.length-1,Math.floor(fixture.edges.length/2))];
  const incrementalA=byId.get(incrementalEdge.from),incrementalB=byId.get(incrementalEdge.to);
  const incrementalObstacles=fixture.nodes.filter(node=>
    node.id!==incrementalA.id&&node.id!==incrementalB.id)
    .map(node=>({id:node.id,x:node.x-12,y:node.y-12,w:110,h:72}));
  const incrementalRoute=routingFindPath(
    {x:incrementalA.x+98,y:incrementalA.y+24},
    {x:incrementalB.x-12,y:incrementalB.y+24},incrementalObstacles,
    {stability:ROUTING_DEFAULT_STABILITY});
  const incrementalMs=performance.now()-incrementalStarted;
  return{
    nodes:nodeCount,links:edgeCount,sampled:Math.min(sampleLimit,edgeCount),
    routed,failed,averageTurns:routed?Math.round(turns/routed*100)/100:0,
    sampleMs:Math.round(sampleMs*10)/10,
    estimatedFullMs:Math.round(sampleMs*edgeCount/Math.min(sampleLimit,edgeCount)*10)/10,
    incrementalMs:Math.round(incrementalMs*100)/100,
    incrementalSucceeded:incrementalRoute.ok,
    fixtureBytes:JSON.stringify(fixture).length
  };
}
function routingRunBenchmark(opts={}){
  const ordinary=routingBenchmarkCase(500,1000,opts.sampleLimit||250);
  const dense=routingBenchmarkCase(1000,3000,opts.sampleLimit||250);
  const report={algorithm:ROUTING_ALGORITHM,version:ROUTING_VERSION,ordinary,dense,
    generatedAt:new Date().toISOString()};
  if(opts.announce!==false)
    alert(`Smart-routing benchmark\n\n500 nodes / 1,000 links: ${ordinary.estimatedFullMs} ms estimated\n`+
      `1,000 nodes / 3,000 links: ${dense.estimatedFullMs} ms estimated\n\n`+
      `Deterministic sample: ${ordinary.sampled} and ${dense.sampled} links.`);
  return report;
}
