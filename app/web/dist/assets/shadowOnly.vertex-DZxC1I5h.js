import{b6 as e}from"./index-CramQklb.js";import{b as a,a as r,c as t,d as l}from"./bakedVertexAnimation-dEAuWn_y.js";import{i as c}from"./instancesDeclaration-RuHj5KSp.js";import{s as d}from"./sceneVertexDeclaration-BT6C5Wkw.js";import{s}from"./sceneUboDeclaration-DXFsauxU.js";import{clipPlaneVertexDeclaration as f}from"./clipPlaneVertexDeclaration-DLK7dc0Q.js";import{logDepthDeclaration as m}from"./logDepthDeclaration-B81GNE1d.js";import{f as p,a as V}from"./fogVertex-BGwPh-f_.js";import{l as x,a as h}from"./lightUboDeclaration-CElhZPZy.js";import{i as u}from"./instancesVertex-Z71VK4-E.js";import{clipPlaneVertex as S}from"./clipPlaneVertex-DXWvCcP-.js";import{l as v}from"./logDepthVertex-Dmmjeh5M.js";import{shadowsVertex as D}from"./shadowsVertex-C38iiRHC.js";const o="shadowOnlyVertexShader",n=`precision highp float;attribute vec3 position;
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
