import{b6 as e}from"./index-Z4a9ijJv.js";import{b as a,a as r,c as t,d as l}from"./bakedVertexAnimation-Dmr5KRh8.js";import{i as c}from"./instancesDeclaration-DqKC6b5R.js";import{s as d}from"./sceneVertexDeclaration-0uRpBzgn.js";import{s}from"./sceneUboDeclaration-BHs0BOry.js";import{clipPlaneVertexDeclaration as f}from"./clipPlaneVertexDeclaration-CekKdrsV.js";import{logDepthDeclaration as m}from"./logDepthDeclaration-BZZDj30Q.js";import{f as p,a as V}from"./fogVertex-1VPKSrcQ.js";import{l as x,a as h}from"./lightUboDeclaration-B3vN7XlC.js";import{i as u}from"./instancesVertex-EQpwzvfv.js";import{clipPlaneVertex as S}from"./clipPlaneVertex-C8a7GGY1.js";import{l as v}from"./logDepthVertex-B14z9iAz.js";import{shadowsVertex as D}from"./shadowsVertex-CakMpJtQ.js";const o="shadowOnlyVertexShader",n=`precision highp float;attribute vec3 position;
#ifdef NORMAL
attribute vec3 normal;
#endif
#include<bonesDeclaration>
#include<bakedVertexAnimationDeclaration>
#include<instancesDeclaration>
#include<__decl__sceneVertex>
#ifdef POINTSIZE
uniform float pointSize;
#endif
varying vec3 vPositionW;
#ifdef NORMAL
varying vec3 vNormalW;
#endif
#ifdef VERTEXCOLOR
varying vec4 vColor;
#endif
#include<clipPlaneVertexDeclaration>
#include<logDepthDeclaration>
#include<fogVertexDeclaration>
#include<__decl__lightFragment>[0..maxSimultaneousLights]
#if defined(CLUSTLIGHT_BATCH) && CLUSTLIGHT_BATCH>0
varying float vViewDepth;
#endif
#define CUSTOM_VERTEX_DEFINITIONS
void main(void) {
#define CUSTOM_VERTEX_MAIN_BEGIN
#include<instancesVertex>
#include<bonesVertex>
#include<bakedVertexAnimation>
vec4 worldPos=finalWorld*vec4(position,1.0);gl_Position=viewProjection*worldPos;vPositionW=vec3(worldPos);
#ifdef NORMAL
vNormalW=normalize(vec3(finalWorld*vec4(normal,0.0)));
#endif
#include<clipPlaneVertex>
#include<logDepthVertex>
#include<fogVertex>
#include<shadowsVertex>[0..maxSimultaneousLights]
#if defined(POINTSIZE) && !defined(WEBGPU)
gl_PointSize=pointSize;
#endif
#define CUSTOM_VERTEX_MAIN_END
}
`;e.ShadersStore[o]||(e.ShadersStore[o]=n);const g=[a,r,c,d,s,f,m,p,x,h,u,t,l,S,v,V,D];for(const i of g)e.IncludesShadersStore[i.name]||(e.IncludesShadersStore[i.name]=i.shader);const R={name:o,shader:n};export{R as shadowOnlyVertexShader};
