import{b6 as e}from"./index-CgKvOhs2.js";import{b as t,a as r,c as a,d as f}from"./bakedVertexAnimation-C_gC7JEJ.js";import{i as d}from"./instancesDeclaration-adm0EGkz.js";import{clipPlaneVertexDeclaration as c}from"./clipPlaneVertexDeclaration-B8KGa37N.js";import{logDepthDeclaration as l}from"./logDepthDeclaration-bRLsqemr.js";import{f as s,a as v}from"./fogVertex-BGq6k7Aa.js";import{l as m,a as u}from"./lightUboDeclaration-BNWL0xSf.js";import{i as V}from"./instancesVertex-CJGjxMOm.js";import{clipPlaneVertex as x}from"./clipPlaneVertex-CfpfRe5i.js";import{shadowsVertex as p}from"./shadowsVertex-D0n0neBf.js";import{v as D}from"./vertexColorMixing-BNhK-6pW.js";import{l as S}from"./logDepthVertex-C2JVFvUM.js";const o="cellVertexShader",n=`precision highp float;attribute vec3 position;
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
#ifdef VERTEXCOLOR
vec4 colorUpdated=color;
#endif
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
#include<fogVertex>
#include<shadowsVertex>[0..maxSimultaneousLights]
#include<vertexColorMixing>
#if defined(POINTSIZE) && !defined(WEBGPU)
gl_PointSize=pointSize;
#endif
#include<logDepthVertex>
#define CUSTOM_VERTEX_MAIN_END
}
`;e.ShadersStore[o]||(e.ShadersStore[o]=n);const g=[t,r,d,c,l,s,m,u,V,a,f,x,v,p,D,S];for(const i of g)e.IncludesShadersStore[i.name]||(e.IncludesShadersStore[i.name]=i.shader);const L={name:o,shader:n};export{L as cellVertexShader};
