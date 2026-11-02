import{b6 as e}from"./index-nL-PFW8x.js";import{b as t,a as r,c as a,d as f}from"./bakedVertexAnimation-Cu8fycAt.js";import{i as d}from"./instancesDeclaration-S8vMHc3D.js";import{clipPlaneVertexDeclaration as c}from"./clipPlaneVertexDeclaration-C-GPN-6e.js";import{logDepthDeclaration as l}from"./logDepthDeclaration-vknM5Iv1.js";import{f as s,a as m}from"./fogVertex-BLmJ17_a.js";import{l as v,a as u}from"./lightUboDeclaration-GAhDtsYO.js";import{i as V}from"./instancesVertex-FvaR03e_.js";import{clipPlaneVertex as x}from"./clipPlaneVertex-tv-PpPWp.js";import{l as D}from"./logDepthVertex-BKQcnqW0.js";import{shadowsVertex as p}from"./shadowsVertex-CwizuAhv.js";const n="normalVertexShader",o=`precision highp float;attribute vec3 position;
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
#ifdef DIFFUSE
varying vec2 vDiffuseUV;uniform mat4 diffuseMatrix;uniform vec2 vDiffuseInfos;
#endif
#ifdef POINTSIZE
uniform float pointSize;
#endif
varying vec3 vPositionW;
#ifdef NORMAL
varying vec3 vNormalW;
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
#ifndef UV1
vec2 uv=vec2(0.,0.);
#endif
#ifndef UV2
vec2 uv2=vec2(0.,0.);
#endif
#ifdef DIFFUSE
if (vDiffuseInfos.x==0.)
{vDiffuseUV=vec2(diffuseMatrix*vec4(uv,1.0,0.0));}
else
{vDiffuseUV=vec2(diffuseMatrix*vec4(uv2,1.0,0.0));}
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
`;e.ShadersStore[n]||(e.ShadersStore[n]=o);const S=[t,r,d,c,l,s,v,u,V,a,f,x,D,m,p];for(const i of S)e.IncludesShadersStore[i.name]||(e.IncludesShadersStore[i.name]=i.shader);const M={name:n,shader:o};export{M as normalVertexShader};
