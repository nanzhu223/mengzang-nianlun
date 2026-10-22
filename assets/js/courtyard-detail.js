/* Courtyard close-up geometry. References: team P299/P300; Beijing Tourism gallery 20716.
 * Geometry is local; the bark map is generated from the team photo reference. No remote textures or dependencies. */
(function () {
  'use strict';
  var T = window.THREE, M = window.NIANLUN_MODULES = window.NIANLUN_MODULES || {};
  var up = new T.Vector3(0, 1, 0), axisZ = new T.Vector3(0, 0, 1);
  var layout = {
    table: [0.4, 0.4], stoolDistance: 1.22,
    pots: [[1.5, -8.4], [5.3, -8.4], [-8.15, -7.6], [8.05, -7.5]],
    treeView: [-1.6, 1.65, -0.9]
  };
  function random(seed) {
    return function () {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      return (seed >>> 0) / 4294967296;
    };
  }
  function mesh(parent, geo, mat, name) {
    var m = new T.Mesh(geo, mat); m.name = name || '';
    m.castShadow = m.receiveShadow = true; parent.add(m); return m;
  }
  function lathe(points, segments) {
    return new T.LatheGeometry(points.map(function (p) { return new T.Vector2(p[0], p[1]); }), segments || 48);
  }
  // Merge structural parts by material rather than creating a draw call for every bolt.
  function batch(parent, parts, mat, name) {
    if (!parts.length) return;
    var total = parts.reduce(function (n, g) { return n + g.attributes.position.count; }, 0);
    var geo = new T.BufferGeometry(), offset = 0;
    ['position', 'normal', 'uv'].forEach(function (key) {
      var size = key === 'uv' ? 2 : 3, data = new Float32Array(total * size); offset = 0;
      parts.forEach(function (g) { data.set(g.attributes[key].array, offset); offset += g.attributes[key].array.length; });
      geo.setAttribute(key, new T.BufferAttribute(data, size));
    });
    parts.forEach(function (g) { g.dispose(); });
    geo.computeBoundingSphere(); return mesh(parent, geo, mat, name);
  }
  function part(list, geometry, p, quaternion, scale) {
    var g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    geometry.dispose();
    if (scale) g.scale(scale[0], scale[1], scale[2]);
    if (quaternion) g.applyQuaternion(quaternion);
    g.translate(p[0], p[1], p[2]); list.push(g);
  }
  function beam(list, a, b, r, bottom) {
    var start = new T.Vector3().fromArray(a), end = new T.Vector3().fromArray(b);
    var delta = end.clone().sub(start), mid = start.clone().add(end).multiplyScalar(0.5);
    part(list, new T.CylinderGeometry(r, bottom || r, delta.length(), 16), mid.toArray(),
      new T.Quaternion().setFromUnitVectors(up, delta.normalize()));
  }
  function barkTextures(onReady) {
    var size=1024,c=document.createElement('canvas'),b=document.createElement('canvas');
    c.width=c.height=b.width=b.height=size;
    var cx=c.getContext('2d'),bx=b.getContext('2d'),r=random(230129);
    // A cheap, local fallback keeps the model available while its detailed map loads.
    cx.fillStyle='#7c7566';cx.fillRect(0,0,size,size);
    for(var j=0;j<850;j++){
      cx.strokeStyle=j%2?'rgba(42,37,29,.24)':'rgba(194,185,160,.22)';cx.lineWidth=.5+r()*3;
      var x=r()*size,y=r()*size;cx.beginPath();cx.moveTo(x,y);cx.bezierCurveTo(x-8,y+37,x+11,y+89,x-2,y+150);cx.stroke();
    }
    bx.drawImage(c,0,0);
    function texture(canvas,color){var t=new T.CanvasTexture(canvas);t.wrapS=t.wrapT=T.RepeatWrapping;t.anisotropy=8;if(color)t.colorSpace=T.SRGBColorSpace;return t;}
    var maps={color:texture(c,true),bump:texture(b,false)};
    if(typeof Image!=='undefined'){
      var image=new Image();
      image.onload=function(){
        cx.drawImage(image,0,0,size,size);bx.drawImage(c,0,0);
        var pixels=bx.getImageData(0,0,size,size),d=pixels.data;
        for(var i=0;i<d.length;i+=4){var value=d[i]*.2126+d[i+1]*.7152+d[i+2]*.0722;d[i]=d[i+1]=d[i+2]=value;}
        bx.putImageData(pixels,0,0);maps.color.needsUpdate=maps.bump.needsUpdate=true;
        if(onReady)onReady(maps);
      };
      image.onerror=function(){console.warn('[courtyard] Detailed bark unavailable; using local fallback.');};
      image.src='assets/materials/jujube-bark-20261021.webp';
    }
    return maps;
  }
  function supports(parent) {
    var steel=[],rubber=[],metal=[];
    var blue=new T.MeshStandardMaterial({color:0x687f87,roughness:.48,metalness:.56});
    var dark=new T.MeshStandardMaterial({color:0x353a36,roughness:.95});
    var bolts=new T.MeshStandardMaterial({color:0xa5aaa7,roughness:.42,metalness:.72});
    // Both collars sit outside the irregular trunk; poles terminate at an offset saddle.
    var joints=[{center:[-.22,2.87,.15],axis:[.05,1,-.06],radius:.59,front:[-.22,2.87,.83],
      feet:[[-1.65,.1,1.6],[.45,.1,1.7]]},
      {center:[1.5,2.45,-.05],axis:[.45,.9,.06],radius:.44,front:[1.5,2.45,.43],
      feet:[[2,.1,1.55],[1.85,.1,-1.6]]}];
    joints.forEach(function(j){
      var dir=new T.Vector3().fromArray(j.axis).normalize();
      var q=new T.Quaternion().setFromUnitVectors(axisZ,dir);
      [-.09,.09].forEach(function(offset){
        var p=new T.Vector3().fromArray(j.center).addScaledVector(dir,offset).toArray();
        part(steel,new T.TorusGeometry(j.radius,.021,6,48),p,q);
        part(rubber,new T.TorusGeometry(j.radius-.026,.026,6,48),p,q);
      });
      var front=j.front;
      [-1,1].forEach(function(side){beam(steel,[front[0]+side*.1,front[1],front[2]-.14],
        [front[0]+side*.1,front[1],front[2]],.026);});
      part(steel,new T.BoxGeometry(.25,.25,.075),front);
      beam(steel,[front[0]-.29,front[1],front[2]],[front[0]+.29,front[1],front[2]],.043);
      j.feet.forEach(function(foot,i){
        var top=[front[0]+(i ? .20:-.20),front[1]-.04,front[2]];
        beam(steel,foot,top,.047);
        // Sleeve/collar at the top; grounded base plate and four anchor nuts.
        var v=new T.Vector3().fromArray(top).sub(new T.Vector3().fromArray(foot)).normalize();
        var cap=new T.Vector3().fromArray(top).addScaledVector(v,-.13).toArray();
        part(metal,new T.CylinderGeometry(.061,.061,.14,16),cap,new T.Quaternion().setFromUnitVectors(up,v));
        part(steel,new T.BoxGeometry(.27,.035,.25),[foot[0],.075,foot[2]]);
        [-1,1].forEach(function(x){[-1,1].forEach(function(z){
          part(metal,new T.CylinderGeometry(.016,.016,.034,6),[foot[0]+x*.09,.108,foot[2]+z*.08]);
        });});
      });
      [-1,1].forEach(function(x){
        part(metal,new T.CylinderGeometry(.025,.025,.06,6),[front[0]+x*.085,front[1],front[2]+.065],
          new T.Quaternion().setFromUnitVectors(up,axisZ));
      });
    });
    batch(parent,steel,blue,'tree-support-frame');batch(parent,rubber,dark,'tree-support-padding');batch(parent,metal,bolts,'tree-support-fittings');
  }
  function treeBed(parent) {
    var r=random(711),c=document.createElement('canvas');c.width=c.height=256;
    var x=c.getContext('2d');x.fillStyle='#55503b';x.fillRect(0,0,256,256);
    for(var i=0;i<8000;i++){x.fillStyle=i%3?'rgba(28,27,19,.18)':'rgba(174,156,110,.32)';x.fillRect(r()*256,r()*256,1+r()*3,1+r()*2);}
    var soil=new T.CanvasTexture(c);soil.colorSpace=T.SRGBColorSpace;soil.wrapS=soil.wrapT=T.RepeatWrapping;soil.repeat.set(4,4);
    var bed=mesh(parent,new T.BoxGeometry(4.8,.035,4.4),new T.MeshStandardMaterial({map:soil,bumpMap:soil,bumpScale:.025,roughness:1}),'tree-soil');bed.position.y=.025;
    var blades=[],leaves=[];
    for(var n=0;n<170;n++){
      var bx=(r()-.5)*4.5,bz=(r()-.5)*4.1;if(Math.hypot(bx,bz)<1)continue;
      var h=.035+r()*.075;
      part(blades,new T.ConeGeometry(.014,h,3),[bx,.043+h/2,bz]);
      if(n%3===0)part(leaves,new T.SphereGeometry(.04,5,3),[bx,.054,bz],null,[1,.12,1.8]);
    }
    batch(parent,blades,new T.MeshStandardMaterial({color:0x627344,roughness:1}),'tree-grass');
    batch(parent,leaves,new T.MeshStandardMaterial({color:0x88734b,roughness:1}),'tree-leaf-litter');
  }
  function furniture(scene, stoneMap) {
    var root=new T.Group();root.name='stone-table-set';scene.add(root);
    var mat=new T.MeshStandardMaterial({map:stoneMap,bumpMap:stoneMap,bumpScale:.018,color:0xb6b4a9,roughness:.86});
    var pieces=[],tx=layout.table[0],tz=layout.table[1];
    function stone(profile,x,z){part(pieces,lathe(profile,64),[x,0,z]);}
    // Closed lathe profiles give the edges actual chamfers rather than stacked cylinders.
    stone([[0,.755],[.65,.755],[.70,.78],[.72,.81],[.72,.865],[.695,.889],[.64,.897],[0,.897]],tx,tz);
    stone([[0,.02],[.40,.02],[.45,.05],[.45,.1],[.40,.14],[.27,.18],[.20,.28],
      [.145,.47],[.16,.59],[.25,.7],[.34,.74],[.34,.76],[0,.76]],tx,tz);
    for(var i=0;i<4;i++){
      var a=Math.PI/4+i*Math.PI/2,sx=tx+Math.cos(a)*layout.stoolDistance,sz=tz+Math.sin(a)*layout.stoolDistance;
      stone([[0,.015],[.25,.015],[.29,.045],[.30,.08],[.28,.11],[.235,.15],[.215,.25],
        [.235,.35],[.275,.39],[.295,.415],[.295,.46],[.275,.48],[0,.48]],sx,sz);
      for(var j=0;j<16;j++){
        var angle=j/16*Math.PI*2;
        var groove=new T.SphereGeometry(.016,5,4);
        part(pieces,groove,[sx+Math.cos(angle)*.225,.265,sz+Math.sin(angle)*.225],null,[1,6.3,1]);
      }
    }
    var m=batch(root,pieces,mat,'stone-beveled-furniture');
    // World projection in metres keeps fine granite grains the same size on all pieces.
    var p=m.geometry.attributes.position,normal=m.geometry.attributes.normal,uv=m.geometry.attributes.uv;
    for(var k=0;k<p.count;k++){
      var ny=Math.abs(normal.getY(k)),nx=Math.abs(normal.getX(k)),nz=Math.abs(normal.getZ(k));
      uv.setXY(k,ny>=nx&&ny>=nz?p.getX(k):nx>nz?p.getZ(k):p.getX(k),ny>=nx&&ny>=nz?p.getZ(k):p.getY(k));
    }
  }
  function plants(scene, wind, small) {
    var pots=[],stems=[],dirt=[],r=random(50172),instances=[],root=new T.Group();
    root.name='courtyard-living-plants';scene.add(root);
    var potMat=new T.MeshStandardMaterial({color:0x715241,roughness:.76});
    var stemMat=new T.MeshStandardMaterial({color:0x63523b,roughness:.93});
    layout.pots.forEach(function(p,index){
      var px=p[0],pz=p[1],height=index<2?1:1.15;
      part(pots,lathe([[0,0],[.18,0],[.21,.04],[.25,.22],[.30,.44],[.345,.45],[.35,.49],
        [.33,.525],[.287,.525],[.275,.475],[.235,.24],[.16,.07],[0,.07]],48),[px,0,pz]);
      part(dirt,new T.CylinderGeometry(.273,.273,.025,32),[px,.46,pz]);
      // A real branching shrub: woody centre, radiating twigs and individually curved leaves.
      beam(stems,[px,.46,pz],[px+.035,1.03*height,pz-.025],.018,.034);
      var branches=small?12:18;
      for(var b=0;b<branches;b++){
        var theta=b*2.399963,base=.61+(b/branches)*.46*height;
        var reach=.22+r()*.18,dx=Math.cos(theta),dz=Math.sin(theta);
        var start=[px+.02,base,pz],end=[px+dx*reach,base+.13+r()*.12,pz+dz*reach];
        beam(stems,start,end,.003,.008);
        for(var l=0;l<5;l++){
          var t=.25+l*.15,alt=l%2?1:-1;
          var center=new T.Vector3(start[0]+(end[0]-start[0])*t,base+(end[1]-base)*t,start[2]+(end[2]-start[2])*t);
          var direction=new T.Vector3(dx*.6-dz*alt*.7,.35+r()*.4,dz*.6+dx*alt*.7).normalize();
          instances.push({p:center,q:new T.Quaternion().setFromUnitVectors(up,direction),s:.85+r()*.55});
        }
      }
    });
    batch(root,pots,potMat,'terracotta-open-pots');batch(root,stems,stemMat,'potted-shrub-branches');
    batch(root,dirt,new T.MeshStandardMaterial({color:0x383024,roughness:1}),'potted-soil');
    var shape=new T.Shape();shape.moveTo(0,0);shape.bezierCurveTo(-.066,.035,-.063,.11,0,.17);shape.bezierCurveTo(.063,.11,.066,.035,0,0);
    var geo=new T.ExtrudeGeometry(shape,{depth:.003,bevelEnabled:true,bevelThickness:.0015,bevelSize:.0015,bevelSegments:1,steps:1,curveSegments:5});
    var positions=geo.attributes.position;
    for(var n=0;n<positions.count;n++){
      var x=positions.getX(n),y=positions.getY(n);
      positions.setZ(n,positions.getZ(n)+Math.sin(y/.17*Math.PI)*.026-Math.abs(x)*.3);
    }
    geo.computeVertexNormals();
    var material=new T.MeshStandardMaterial({color:0xffffff,roughness:.66});
    material.onBeforeCompile=function(shader){
      shader.uniforms.uPlantTime=wind;
      shader.vertexShader='uniform float uPlantTime;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\ntransformed.x += sin(uPlantTime*1.1 + instanceMatrix[3].x*2.0 + instanceMatrix[3].z)*0.014*position.y/0.17;');
    };
    var leaves=new T.InstancedMesh(geo,material,instances.length),dummy=new T.Object3D(),color=new T.Color();
    instances.forEach(function(v,i){dummy.position.copy(v.p);dummy.quaternion.copy(v.q);dummy.scale.setScalar(v.s);dummy.updateMatrix();leaves.setMatrixAt(i,dummy.matrix);
      color.setHSL(.235+r()*.045,.32+r()*.2,.20+r()*.12);leaves.setColorAt(i,color);});
    leaves.name='potted-curved-solid-leaves';leaves.castShadow=leaves.receiveShadow=true;root.add(leaves);
    // Matching depth displacement prevents leaf shadows separating from wind-blown leaves.
    var depth=new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking});depth.onBeforeCompile=material.onBeforeCompile;
    leaves.customDepthMaterial=depth;
  }
  function sky(scene, wind) {
    var mat=new T.ShaderMaterial({side:T.BackSide,depthWrite:false,fog:false,toneMapped:false,
      uniforms:{uTime:wind},vertexShader:'varying vec3 vDirection; void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader:[
        'uniform float uTime; varying vec3 vDirection;',
        'float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
        'float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}',
        'float fbm(vec2 p){float v=0.0;v+=.55*noise(p);p=p*2.03+17.1;v+=.27*noise(p);p=p*2.01+9.2;v+=.12*noise(p);v+=.06*noise(p*2.0);return v;}',
        'void main(){vec3 d=normalize(vDirection);float h=max(d.y,0.0);',
        'vec3 color=mix(vec3(.77,.87,.93),vec3(.24,.51,.76),pow(h,.42));',
        'vec2 p=d.xz/(.29+h)*3.4+vec2(uTime*.006,0.0);',
        'float field=fbm(p+fbm(p*.7));float clouds=smoothstep(.49,.69,field)*smoothstep(.015,.20,h);',
        'vec3 cloud=mix(vec3(.80,.85,.89),vec3(1.0,.995,.98),smoothstep(.48,.74,field));',
        'color=mix(color,cloud,clouds*.94); gl_FragColor=vec4(color,1.0);}'
      ].join('\n')});
    var dome=new T.Mesh(new T.SphereGeometry(180,32,20),mat);dome.name='blue-sky-moving-clouds';dome.frustumCulled=false;
    scene.add(dome);return dome;
  }
  function obstacles() {
    var tx=layout.table[0],tz=layout.table[1],list=[[tx,tz,1.0],[7.2,-5.4,.9]];
    for(var i=0;i<4;i++){var a=Math.PI/4+i*Math.PI/2;list.push([tx+Math.cos(a)*layout.stoolDistance,tz+Math.sin(a)*layout.stoolDistance,.56]);}
    layout.pots.forEach(function(p){list.push([p[0],p[1],.6]);});return list;
  }
  M.courtyardDetail={layout:layout,barkTextures:barkTextures,supports:supports,treeBed:treeBed,
    furniture:furniture,plants:plants,sky:sky,obstacles:obstacles};
})();
