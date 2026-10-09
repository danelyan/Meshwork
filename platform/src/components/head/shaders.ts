export const vertexShader = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
uniform vec2 uAngle;
uniform float uAspect;
out vec3 vPosition;
out vec3 vNormal;
mat3 rotation(vec2 a) {
  float cy=cos(a.x), sy=sin(a.x), cx=cos(a.y), sx=sin(a.y);
  return mat3(cy,0.,-sy, 0.,1.,0., sy,0.,cy)*mat3(1.,0.,0., 0.,cx,sx, 0.,-sx,cx);
}
void main() {
  mat3 r=rotation(uAngle);
  vec3 p=r*(aPosition-vec3(0.,.5,0.));
  vPosition=p;
  vNormal=normalize(r*aNormal);
  gl_Position=vec4(p.x*1.72/uAspect,p.y*1.72,-p.z*.5,1.);
}`;

export const fragmentShader = `#version 300 es
precision highp float;
in vec3 vPosition;
in vec3 vNormal;
uniform vec3 uPaper;
uniform vec3 uInk;
uniform vec3 uMuted;
// CSS-pixel origin and dimensions preserve the page grid across DPR and scroll.
uniform vec4 uViewport;
uniform float uDpr;
out vec4 color;
float grid(vec2 point, float spacing, float width) {
  vec2 p=point/spacing;
  vec2 distanceToLine=abs(fract(p-.5)-.5)*spacing;
  vec2 aa=max(fwidth(point),vec2(.5));
  vec2 line=1.-smoothstep(vec2(width),vec2(width)+aa,distanceToLine);
  return max(line.x,line.y);
}
void main() {
  vec3 n=normalize(vNormal);
  float facing=abs(n.z);
  vec2 screen=uViewport.xy+vec2(gl_FragCoord.x/uDpr,uViewport.w-gl_FragCoord.y/uDpr);
  // A depth-based stretch avoids magnifying the source mesh's tiny bumps.
  // The page grid stays fixed while its sheet is pushed out by the face.
  vec2 sheet=vPosition.xy-vec2(0.,.06);
  vec2 pressed=screen+sheet*max(vPosition.z,0.)*uViewport.w*.7;
  float major=grid(pressed,48.,.42);
  float minor=grid(pressed,24.,.22);
  float light=max(dot(n,normalize(vec3(-.5,.7,1.4))),0.);
  float relief=(1.-light)*.32;
  vec3 surface=mix(uPaper,uMuted,relief);
  float lines=major*.23+minor*.07;
  vec3 paint=mix(surface,uInk,lines);
  float edge=smoothstep(.02,.34,facing);
  float neck=smoothstep(-.47,-.29,vPosition.y);
  float alpha=edge*neck*.88;
  // The WebGL canvas uses premultiplied alpha over the page background.
  color=vec4(paint*alpha,alpha);
}`;
