/** First pass stores a height field, never a painted head. */
export const vertexShader = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
uniform vec2 uAngle;
uniform vec4 uAnchor;
uniform vec2 uStage;
uniform float uBlink;
uniform float uBreath;
out vec3 vPosition;
out vec3 vNormal;
mat3 rotation(vec2 a) {
  float cy=cos(a.x), sy=sin(a.x), cx=cos(a.y), sx=sin(a.y);
  return mat3(cy,0.,-sy, 0.,1.,0., sy,0.,cy)*mat3(1.,0.,0., 0.,cx,sx, 0.,-sx,cx);
}
void main() {
  vec3 local=aPosition;
  // No rig: a feathered eyelid press animates the relief instead.
  float eye=exp(-pow((abs(local.x)-.105)/.055,2.)-pow((local.y-.63)/.04,2.));
  local.y+=(.63-local.y)*eye*uBlink*.8;
  local.z+=eye*uBlink*.009;
  mat3 r=rotation(uAngle);
  vec3 p=r*(local-vec3(0.,.5,0.));
  p.y+=uBreath;
  vPosition=p;
  vNormal=normalize(r*aNormal);
  float scale=min(uAnchor.w*.84,uAnchor.z*1.55);
  vec2 center=vec2(uAnchor.x+uAnchor.z*.5,uAnchor.y+uAnchor.w*.48);
  vec2 pixel=center+vec2(p.x,-p.y)*scale;
  gl_Position=vec4(pixel.x/uStage.x*2.-1.,1.-pixel.y/uStage.y*2.,-p.z*.5,1.);
}`;

export const heightFragmentShader = `#version 300 es
precision highp float;
in vec3 vPosition;
in vec3 vNormal;
out vec4 color;
void main() {
  float neck=smoothstep(-.48,-.30,vPosition.y);
  float height=max(0.,vPosition.z+.11)*neck;
  // Two normalized bytes preserve smooth derivatives without float-texture extensions.
  float packed=clamp(height,0.,1.)*255.;
  color=vec4(floor(packed)/255.,fract(packed),0.,1.);
}`;

export const sheetVertexShader = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));
  vUv=p;
  gl_Position=vec4(p*2.-1.,0.,1.);
}`;

export const fragmentShader = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uHeight;
uniform vec2 uTextureSize;
uniform vec4 uViewport;
uniform vec2 uPageOffset;
uniform vec4 uAnchor;
uniform vec3 uPaper;
uniform vec3 uInk;
uniform float uTime;
out vec4 color;
float field(vec2 uv) {
  return dot(texture(uHeight,uv).rg,vec2(1.,1./255.));
}
float heightAt(vec2 uv) {
  // A dense Gaussian avoids repeated silhouettes from widely spaced taps.
  vec2 stepSize=vec2(2.5)/uTextureSize;
  const float weights[5]=float[5](1.,4.,6.,4.,1.);
  float h=0.;
  for (int x=0;x<5;x++) {
    for (int y=0;y<5;y++) {
      vec2 offset=vec2(float(x-2),float(y-2))*stepSize;
      h+=field(uv+offset)*weights[x]*weights[y];
    }
  }
  return h/256.;
}
float grid(vec2 point,float spacing,float width) {
  vec2 q=point/spacing;
  vec2 d=abs(fract(q-.5)-.5)*spacing;
  vec2 aa=max(fwidth(point),vec2(.5));
  vec2 line=1.-smoothstep(vec2(width),vec2(width)+aa,d);
  return max(line.x,line.y);
}
void main() {
  vec2 screen=vec2(vUv.x,1.-vUv.y)*uViewport.zw;
  vec2 page=screen+uViewport.xy+uPageOffset;
  // One travelling wave belongs to the entire sheet, including the pressed face.
  vec2 wave=vec2(
    sin(page.y*.009+page.x*.003-uTime*.47)*4.+sin(page.x*.006+uTime*.31)*2.,
    sin(page.x*.008-page.y*.003+uTime*.39)*4.+cos(page.y*.007-uTime*.27)*2.
  );
  float h=0.;
  vec2 slope=vec2(0.);
  bool nearFace=screen.x>=uAnchor.x-40. && screen.x<=uAnchor.x+uAnchor.z+40. &&
    screen.y>=uAnchor.y-40. && screen.y<=uAnchor.y+uAnchor.w+40.;
  if (nearFace) {
    h=heightAt(vUv);
    vec2 delta=vec2(3.)/uViewport.zw;
    slope=vec2(heightAt(vUv+vec2(delta.x,0.))-heightAt(vUv-vec2(delta.x,0.)),
      heightAt(vUv-vec2(0.,delta.y))-heightAt(vUv+vec2(0.,delta.y)));
  }
  vec2 center=uAnchor.xy+uAnchor.zw*vec2(.5,.48);
  vec2 radial=(screen-center)/max(uAnchor.w,1.);
  // The same plane continues through the face; no mesh silhouette is drawn.
  vec2 pressure=clamp(slope*uAnchor.w*1.6,vec2(-18.),vec2(18.));
  vec2 pressed=page+wave+radial*h*uAnchor.w*.35+pressure;
  // Identical spacing, stroke and ink throughout: the face only bends this net.
  float lines=grid(pressed,24.,.42)*.14;
  color=vec4(mix(uPaper,uInk,lines),1.);
}`;
