import{b6 as e}from"./index-BW7gnprn.js";import{b as t,a as r,c as a,d}from"./bakedVertexAnimation-ChzfnzW1.js";import{i as l}from"./instancesDeclaration-wsy1zk4t.js";import{clipPlaneVertexDeclaration as c}from"./clipPlaneVertexDeclaration-1AKVQR3C.js";import{logDepthDeclaration as f}from"./logDepthDeclaration-JcL19lVh.js";import{f as s,a as m}from"./fogVertex-I-BCLPRv.js";import{l as v,a as u}from"./lightUboDeclaration-BNBNo2Y0.js";import{i as V}from"./instancesVertex-BohxnLLD.js";import{clipPlaneVertex as p}from"./clipPlaneVertex-jhXOYv0d.js";import{l as x}from"./logDepthVertex-BfCeFYfh.js";import{shadowsVertex as g}from"./shadowsVertex-BmAqO9Q_.js";import{v as S}from"./vertexColorMixing-Cnh_V4wE.js";const o="gradientVertexShader",n=`precision highp float;attribute vec3 position;
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
#ifdef POINTSIZE
uniform float pointSize;
#endif
varying vec3 vPositionW;varying vec3 vPosition;
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
vec4 worldPos=finalWorld*vec4(position,1.0);gl_Position=viewProjection*worldPos;vPositionW=vec3(worldPos);vPosition=position;
#ifdef NORMAL
vNormalW=normalize(vec3(finalWorld*vec4(normal,0.0)));
#endif
#ifndef UV1
vec2 uv=vec2(0.,0.);
#endif
#ifndef UV2
vec2 uv2=vec2(0.,0.);
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
`;e.ShadersStore[o]||(e.ShadersStore[o]=n);const h=[t,r,l,c,f,s,v,u,V,a,d,p,x,m,g,S];for(const i of h)e.IncludesShadersStore[i.name]||(e.IncludesShadersStore[i.name]=i.shader);const U={name:o,shader:n};export{U as gradientVertexShader};
