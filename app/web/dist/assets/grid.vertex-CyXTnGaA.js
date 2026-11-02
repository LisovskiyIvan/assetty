import{b6 as e}from"./index-nL-PFW8x.js";import{i as t}from"./instancesDeclaration-S8vMHc3D.js";import{s as n}from"./sceneVertexDeclaration-DDi3Z53z.js";import{s as a}from"./sceneUboDeclaration-DRr0IYFR.js";import{logDepthDeclaration as c}from"./logDepthDeclaration-vknM5Iv1.js";import{f as d,a as f}from"./fogVertex-BLmJ17_a.js";import{clipPlaneVertexDeclaration as s}from"./clipPlaneVertexDeclaration-C-GPN-6e.js";import{i as l}from"./instancesVertex-FvaR03e_.js";import{clipPlaneVertex as v}from"./clipPlaneVertex-tv-PpPWp.js";import{l as p}from"./logDepthVertex-BKQcnqW0.js";const o="gridVertexShader",r=`precision highp float;attribute vec3 position;attribute vec3 normal;
#ifdef UV1
attribute vec2 uv;
#endif
#ifdef UV2
attribute vec2 uv2;
#endif
#include<instancesDeclaration>
#include<__decl__sceneVertex>
varying vec3 vPosition;varying vec3 vNormal;
#if defined(HORIZON_FADE) || defined(BELOW_LINE_COLOR) || defined(ORIGIN_MARKER)
varying vec3 vWorldPos;
#endif
#include<logDepthDeclaration>
#include<fogVertexDeclaration>
#ifdef OPACITY
varying vec2 vOpacityUV;uniform mat4 opacityMatrix;uniform vec2 vOpacityInfos;
#endif
#include<clipPlaneVertexDeclaration>
#define CUSTOM_VERTEX_DEFINITIONS
void main(void) {
#define CUSTOM_VERTEX_MAIN_BEGIN
#include<instancesVertex>
vec4 worldPos=finalWorld*vec4(position,1.0);
#include<fogVertex>
vec4 cameraSpacePosition=view*worldPos;gl_Position=projection*cameraSpacePosition;
#ifdef OPACITY
#ifndef UV1
vec2 uv=vec2(0.,0.);
#endif
#ifndef UV2
vec2 uv2=vec2(0.,0.);
#endif
if (vOpacityInfos.x==0.)
{vOpacityUV=vec2(opacityMatrix*vec4(uv,1.0,0.0));}
else
{vOpacityUV=vec2(opacityMatrix*vec4(uv2,1.0,0.0));}
#endif 
#include<clipPlaneVertex>
#include<logDepthVertex>
vPosition=position;vNormal=normal;
#if defined(HORIZON_FADE) || defined(BELOW_LINE_COLOR) || defined(ORIGIN_MARKER)
vWorldPos=worldPos.xyz;
#endif
#define CUSTOM_VERTEX_MAIN_END
}`;e.ShadersStore[o]||(e.ShadersStore[o]=r);const m=[t,n,a,c,d,s,l,f,v,p];for(const i of m)e.IncludesShadersStore[i.name]||(e.IncludesShadersStore[i.name]=i.shader);const P={name:o,shader:r};export{P as gridVertexShader};
