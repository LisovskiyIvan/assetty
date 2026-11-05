import{b6 as e}from"./index-D5UMdsmS.js";import{b as r,a as t,c as a,d as f}from"./bakedVertexAnimation-R3KNSPt1.js";import{i as d}from"./instancesDeclaration-CAfRMIkY.js";import{clipPlaneVertexDeclaration as l}from"./clipPlaneVertexDeclaration-DWJhSyMh.js";import{f as c,a as v}from"./fogVertex-6TGfo9Db.js";import{l as m,a as s}from"./lightUboDeclaration-Dxk85YoE.js";import{logDepthDeclaration as u}from"./logDepthDeclaration-XFxSzGT-.js";import{i as w}from"./instancesVertex-DxyH6g2s.js";import{clipPlaneVertex as x}from"./clipPlaneVertex-BTgSFoPH.js";import{shadowsVertex as p}from"./shadowsVertex-J9snhd5j.js";import{v as g}from"./vertexColorMixing-CWFnjwHh.js";import{l as P}from"./logDepthVertex-Cp9rxMSP.js";const o="waterVertexShader",n=`precision highp float;attribute vec3 position;
#ifdef NORMAL
attribute vec3 normal;
#endif
#ifdef UV1
attribute vec2 uv;
#endif
#ifdef UV2
attribute vec2 uv2;
#endif
#ifdef VERTEXCOLOR
attribute vec4 color;
#endif
#include<bonesDeclaration>
#include<bakedVertexAnimationDeclaration>
#include<instancesDeclaration>
uniform mat4 view;uniform mat4 viewProjection;
#ifdef BUMP
varying vec2 vNormalUV;
#ifdef BUMPSUPERIMPOSE
varying vec2 vNormalUV2;
#endif
uniform mat4 normalMatrix;uniform vec2 vNormalInfos;
#endif
#ifdef POINTSIZE
uniform float pointSize;
#endif
varying vec3 vPositionW;
#ifdef NORMAL
varying vec3 vNormalW;
#endif
#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
varying vec4 vColor;
#endif
#include<clipPlaneVertexDeclaration>
#include<fogVertexDeclaration>
#include<__decl__lightFragment>[0..maxSimultaneousLights]
#include<logDepthDeclaration>
uniform mat4 reflectionViewProjection;uniform vec2 windDirection;uniform float waveLength;uniform float time;uniform float windForce;uniform float waveHeight;uniform float waveSpeed;uniform float waveCount;varying vec3 vRefractionMapTexCoord;varying vec3 vReflectionMapTexCoord;
#if defined(CLUSTLIGHT_BATCH) && CLUSTLIGHT_BATCH>0
varying float vViewDepth;
#endif
#define CUSTOM_VERTEX_DEFINITIONS
void main(void) {
#define CUSTOM_VERTEX_MAIN_BEGIN
#ifdef VERTEXCOLOR
vec4 colorUpdated=color;
#endif
#include<instancesVertex>
#include<bonesVertex>
#include<bakedVertexAnimation>
vec4 worldPos=finalWorld*vec4(position,1.0);vPositionW=vec3(worldPos);
#ifdef NORMAL
vNormalW=normalize(vec3(finalWorld*vec4(normal,0.0)));
#endif
#ifndef UV1
vec2 uv=vec2(0.,0.);
#endif
#ifndef UV2
vec2 uv2=vec2(0.,0.);
#endif
#ifdef BUMP
if (vNormalInfos.x==0.)
{vNormalUV=vec2(normalMatrix*vec4((uv*1.0)/waveLength+time*windForce*windDirection,1.0,0.0));
#ifdef BUMPSUPERIMPOSE
vNormalUV2=vec2(normalMatrix*vec4((uv*0.721)/waveLength+time*1.2*windForce*windDirection,1.0,0.0));
#endif
}
else
{vNormalUV=vec2(normalMatrix*vec4((uv2*1.0)/waveLength+time*windForce*windDirection ,1.0,0.0));
#ifdef BUMPSUPERIMPOSE
vNormalUV2=vec2(normalMatrix*vec4((uv2*0.721)/waveLength+time*1.2*windForce*windDirection ,1.0,0.0));
#endif
}
#endif
#include<clipPlaneVertex>
#include<fogVertex>
#include<shadowsVertex>[0..maxSimultaneousLights]
#include<vertexColorMixing>
#if defined(POINTSIZE) && !defined(WEBGPU)
gl_PointSize=pointSize;
#endif
float finalWaveCount=1.0/(waveCount*0.5);
#ifdef USE_WORLD_COORDINATES
vec3 p=worldPos.xyz;
#else
vec3 p=position;
#endif
float newY=(sin(((p.x/finalWaveCount)+time*waveSpeed))*waveHeight*windDirection.x*5.0)
+ (cos(((p.z/finalWaveCount)+ time*waveSpeed))*waveHeight*windDirection.y*5.0);p.y+=abs(newY);
#ifdef USE_WORLD_COORDINATES
gl_Position=viewProjection*vec4(p,1.0);
#else
gl_Position=viewProjection*finalWorld*vec4(p,1.0);
#endif
#ifdef REFLECTION
vRefractionMapTexCoord.x=0.5*(gl_Position.w+gl_Position.x);vRefractionMapTexCoord.y=0.5*(gl_Position.w+gl_Position.y);vRefractionMapTexCoord.z=gl_Position.w;worldPos=reflectionViewProjection*finalWorld*vec4(position,1.0);vReflectionMapTexCoord.x=0.5*(worldPos.w+worldPos.x);vReflectionMapTexCoord.y=0.5*(worldPos.w+worldPos.y);vReflectionMapTexCoord.z=worldPos.w;
#endif
#include<logDepthVertex>
#define CUSTOM_VERTEX_MAIN_END
}
`;e.ShadersStore[o]||(e.ShadersStore[o]=n);const S=[r,t,d,l,c,m,s,u,w,a,f,x,v,p,g,P];for(const i of S)e.IncludesShadersStore[i.name]||(e.IncludesShadersStore[i.name]=i.shader);const I={name:o,shader:n};export{I as waterVertexShader};
