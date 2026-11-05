import{b6 as e}from"./index-BNNeZAnZ.js";import{b as t,a as r,c as a,d as f}from"./bakedVertexAnimation-Dmc4su0o.js";import{i as d}from"./instancesDeclaration-BYt_uinp.js";import{clipPlaneVertexDeclaration as c}from"./clipPlaneVertexDeclaration-C7fcmk3L.js";import{logDepthDeclaration as l}from"./logDepthDeclaration-B3dFxubp.js";import{f as s,a as v}from"./fogVertex-BcFZBwHq.js";import{l as m,a as u}from"./lightUboDeclaration-DsRXMm6T.js";import{i as V}from"./instancesVertex-DXExNsx0.js";import{clipPlaneVertex as x}from"./clipPlaneVertex-BvNFQOjZ.js";import{l as p}from"./logDepthVertex-DFs9CD5d.js";import{shadowsVertex as S}from"./shadowsVertex-BtgPfhOw.js";import{v as D}from"./vertexColorMixing-DaQchqXn.js";const o="simpleVertexShader",n=`precision highp float;attribute vec3 position;
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
#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
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
#include<logDepthVertex>
#include<fogVertex>
#include<shadowsVertex>[0..maxSimultaneousLights]
#include<vertexColorMixing>
#if defined(POINTSIZE) && !defined(WEBGPU)
gl_PointSize=pointSize;
#endif
#define CUSTOM_VERTEX_MAIN_END
}
`;e.ShadersStore[o]||(e.ShadersStore[o]=n);const g=[t,r,d,c,l,s,m,u,V,a,f,x,p,v,S,D];for(const i of g)e.IncludesShadersStore[i.name]||(e.IncludesShadersStore[i.name]=i.shader);const L={name:o,shader:n};export{L as simpleVertexShader};
