import{b6 as e}from"./index-CObigdMN.js";import{i as t}from"./instancesDeclaration-D4I0DrDl.js";import{s as n}from"./sceneVertexDeclaration-B4X8Shkb.js";import{s as a}from"./sceneUboDeclaration-BtXQy_xu.js";import{logDepthDeclaration as c}from"./logDepthDeclaration-BFER5X4-.js";import{f as d,a as f}from"./fogVertex-Cg2rG9Uc.js";import{clipPlaneVertexDeclaration as s}from"./clipPlaneVertexDeclaration-MV3EU45L.js";import{i as l}from"./instancesVertex-BUYItCN9.js";import{clipPlaneVertex as v}from"./clipPlaneVertex-D6Nj6ePX.js";import{l as p}from"./logDepthVertex-CxRtsocS.js";const o="gridVertexShader",r=`precision highp float;attribute vec3 position;attribute vec3 normal;
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
