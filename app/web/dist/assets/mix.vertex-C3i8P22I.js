import{b6 as e}from"./index-CTe2nUuT.js";import{b as r,a as n,c as a,d as f}from"./bakedVertexAnimation-BVKlOV3h.js";import{i as d}from"./instancesDeclaration-RaGxk60P.js";import{clipPlaneVertexDeclaration as c}from"./clipPlaneVertexDeclaration-Ce-0f17m.js";import{logDepthDeclaration as l}from"./logDepthDeclaration-BjOl9tWv.js";import{f as s,a as v}from"./fogVertex-DQhjg24a.js";import{l as m,a as u}from"./lightUboDeclaration-B4HzaE4b.js";import{i as x}from"./instancesVertex-W066UPp_.js";import{clipPlaneVertex as V}from"./clipPlaneVertex-BcPafbmE.js";import{shadowsVertex as p}from"./shadowsVertex-CFE2OkvK.js";import{v as S}from"./vertexColorMixing-ZxtazBlL.js";import{l as g}from"./logDepthVertex-CAbznnzM.js";const t="mixVertexShader",o=`precision highp float;attribute vec3 position;
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
varying vec2 vTextureUV;uniform mat4 textureMatrix;uniform vec2 vTextureInfos;
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
if (vTextureInfos.x==0.)
{vTextureUV=vec2(textureMatrix*vec4(uv,1.0,0.0));}
else
{vTextureUV=vec2(textureMatrix*vec4(uv2,1.0,0.0));}
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
`;e.ShadersStore[t]||(e.ShadersStore[t]=o);const h=[r,n,d,c,l,s,m,u,x,a,f,V,v,p,S,g];for(const i of h)e.IncludesShadersStore[i.name]||(e.IncludesShadersStore[i.name]=i.shader);const L={name:t,shader:o};export{L as mixVertexShader};
