import{b6 as e}from"./index-Co7RwRrn.js";import{b as r,a as t,c as a,d}from"./bakedVertexAnimation-D_5Tp8mj.js";import{clipPlaneVertexDeclaration as c}from"./clipPlaneVertexDeclaration-BLe0F9zP.js";import{f as l,a as s}from"./fogVertex-Dmq_T_NV.js";import{i as f}from"./instancesDeclaration-DqcTFd42.js";import{i as m}from"./instancesVertex-CGbwkmNR.js";import{clipPlaneVertex as V}from"./clipPlaneVertex-BZkA0MF2.js";import{v as x}from"./vertexColorMixing-BRPHqMHx.js";const o="colorVertexShader",n=`attribute vec3 position;
#ifdef VERTEXCOLOR
attribute vec4 color;
#endif
#include<bonesDeclaration>
#include<bakedVertexAnimationDeclaration>
#include<clipPlaneVertexDeclaration>
#include<fogVertexDeclaration>
#ifdef FOG
uniform mat4 view;
#endif
#include<instancesDeclaration>
uniform mat4 viewProjection;
#ifdef MULTIVIEW
uniform mat4 viewProjectionR;
#endif
#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
varying vec4 vColor;
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
vec4 worldPos=finalWorld*vec4(position,1.0);
#ifdef MULTIVIEW
if (gl_ViewID_OVR==0u) {gl_Position=viewProjection*worldPos;} else {gl_Position=viewProjectionR*worldPos;}
#else
gl_Position=viewProjection*worldPos;
#endif
#include<clipPlaneVertex>
#include<fogVertex>
#include<vertexColorMixing>
#define CUSTOM_VERTEX_MAIN_END
}`;e.ShadersStore[o]||(e.ShadersStore[o]=n);const u=[r,t,c,l,f,m,a,d,V,s,x];for(const i of u)e.IncludesShadersStore[i.name]||(e.IncludesShadersStore[i.name]=i.shader);const D={name:o,shader:n};export{D as colorVertexShader};
