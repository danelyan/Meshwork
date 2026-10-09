export const vertexShader = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUV;
layout(location=3) in vec3 aSmooth;
layout(location=4) in vec3 aSmoothNormal;
uniform vec2 uAngle;
uniform vec2 uPointer;
uniform float uAspect;
uniform float uTime;
uniform float uStrength;
uniform float uSmooth;
uniform float uZoom;
uniform float uBurst;
uniform int uMode;
out vec3 vPosition;
out vec3 vNormal;
out vec2 vUV;
out float vWave;
float hash(vec3 p) { return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453); }
mat3 rotation(vec2 a) {
  float cy=cos(a.x), sy=sin(a.x), cx=cos(a.y), sx=sin(a.y);
  return mat3(cy,0.,-sy, 0.,1.,0., sy,0.,cy)*mat3(1.,0.,0., 0.,cx,sx, 0.,-sx,cx);
}
void main() {
  vec3 p=mix(aPosition,aSmooth,uSmooth)-vec3(0.,.5,0.);
  mat3 r=rotation(uAngle);
  vec3 n=normalize(r*mix(aNormal,aSmoothNormal,uSmooth));
  p=r*p;
  float d=distance(p.xy,uPointer*vec2(.4,.48));
  vWave=sin(d*34.-uTime*4.)*exp(-d*3.5);
  if(uMode==3) p+=n*vWave*.025*uStrength;
  if(uMode==2) {
    float seed=hash(aPosition);
    vec3 direction=normalize(vec3(hash(aPosition.zxy)*2.-1.,hash(aPosition.yxz)*2.-1.,hash(aPosition.xyz)*2.-1.));
    float influence=exp(-d*d*12.)*(.5+.5*sin(uTime*1.7));
    p+=direction*(uBurst+influence*.16)*uStrength*(.2+seed*.8);
    p.xy+=vec2(sin(uTime+seed*30.),cos(uTime*.7+seed*20.))*.004*uStrength;
  }
  vPosition=p; vNormal=n; vUV=aUV;
  gl_Position=vec4(p.x*1.72*uZoom/uAspect,p.y*1.72*uZoom,-p.z*.5,1.);
  gl_PointSize=2.1+hash(aPosition)*1.7;
}`;

export const fragmentShader = `#version 300 es
precision highp float;
precision highp int;
in vec3 vPosition;
in vec3 vNormal;
in vec2 vUV;
in float vWave;
uniform sampler2D uTexture;
uniform sampler2D uNormalMap;
uniform vec3 uAccent;
uniform vec3 uSilver;
uniform vec2 uPointer;
uniform float uTime;
uniform float uStrength;
uniform float uSmooth;
uniform int uMode;
uniform int uWire;
out vec4 color;
void main() {
  vec3 n=normalize(vNormal);
  vec3 dp1=dFdx(vPosition), dp2=dFdy(vPosition);
  vec2 duv1=dFdx(vUV), duv2=dFdy(vUV);
  vec3 tangent=normalize(dp1*duv2.y-dp2*duv1.y);
  vec3 bitangent=normalize(-dp1*duv2.x+dp2*duv1.x);
  vec3 mapN=texture(uNormalMap,vUV).xyz*2.-1.;
  mapN.xy*=mix(.5,.08,uSmooth);
  vec3 detail=normalize(mat3(tangent,bitangent,n)*normalize(mapN));
  n=normalize(mix(n,detail,.55));
  float facing=abs(n.z), rim=pow(1.-facing,2.5);
  vec3 l=normalize(vec3(uPointer.x*.8-.6,uPointer.y*.7+.9,1.2));
  float diffuse=max(dot(n,l),0.);
  float spec=pow(max(dot(reflect(-l,n),vec3(0.,0.,1.)),0.),40.);
  vec3 refl=reflect(vec3(0.,0.,-1.),n);
  float strip=pow(.5+.5*sin(refl.x*8.+refl.y*3.+uPointer.x*1.5),6.);
  float lattice=dot(texture(uTexture,vUV).rgb,vec3(.2126,.7152,.0722));
  vec3 metal=uSilver*(.11+.58*diffuse+.8*strip*uStrength+.8*spec*uStrength)*(.5+.65*lattice);
  metal+=uAccent*rim*.32;
  if(uMode==0) { color=vec4(metal,1.); }
  if(uMode==1) {
    float scanY=sin(uTime*.65+uPointer.y*1.2)*.48;
    float scan=exp(-abs(vPosition.y-scanY)*65.);
    float lines=pow(.5+.5*sin(vPosition.y*750.),12.);
    vec3 c=mix(uAccent,uSilver,.45)*(.16+facing*.2+lines*.32+rim*1.5+scan*2.*uStrength);
    color=vec4(c,1.);
  }
  if(uMode==2) {
    float d=length(gl_PointCoord-.5);
    if(d>.5) discard;
    vec3 c=mix(uAccent,uSilver,clamp(facing*.85+.25,0.,1.));
    color=vec4(c*(.5+diffuse*.7),smoothstep(.5,.2,d)*.9);
  }
  if(uMode==3) {
    float ring=pow(max(vWave,0.),4.);
    color=vec4(mix(metal,uAccent+uSilver*.4,ring*.7*uStrength),1.);
  }
  if(uMode==4) {
    float glow=exp(-distance(vPosition.xy,uPointer*vec2(.4,.48))*9.);
    color=vec4(uWire==1 ? mix(uSilver*.26,uAccent+uSilver*.6,glow*uStrength) : uSilver*(.02+.045*diffuse),1.);
  }
  color.rgb=pow(max(color.rgb,vec3(0.)),vec3(.85));
}`;
