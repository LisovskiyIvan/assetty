import{b6 as e}from"./index-Co7RwRrn.js";import{logDepthDeclaration as t}from"./logDepthDeclaration-oVsvmYVz.js";import{clipPlaneVertexDeclaration as n}from"./clipPlaneVertexDeclaration-BLe0F9zP.js";import{f as a,a as d}from"./fogVertex-Dmq_T_NV.js";import{clipPlaneVertex as l}from"./clipPlaneVertex-BZkA0MF2.js";import{l as f}from"./logDepthVertex-tovCElHq.js";const i="skyVertexShader",r=`precision highp float;attribute vec3 position;
#ifdef VERTEXCOLOR
attribute vec4 color;
#endif
uniform mat4 world;uniform mat4 view;uniform mat4 viewProjection;
#ifdef POINTSIZE
uniform float pointSize;
#endif
varying vec3 vPositionW;
#ifdef VERTEXCOLOR
varying vec4 vColor;
#endif
#include<logDepthDeclaration>
#include<clipPlaneVertexDeclaration>
#include<fogVertexDeclaration>
#define CUSTOM_VERTEX_DEFINITIONS
void main(void) {
#define CUSTOM_VERTEX_MAIN_BEGIN
gl_Position=viewProjection*world*vec4(position,1.0);vec4 worldPos=world*vec4(position,1.0);vPositionW=vec3(worldPos);
#include<clipPlaneVertex>
#include<logDepthVertex>
#include<fogVertex>
#ifdef VERTEXCOLOR
vColor=color;
#endif
#if defined(POINTSIZE) && !defined(WEBGPU)
gl_PointSize=pointSize;
#endif
#define CUSTOM_VERTEX_MAIN_END
}
`;e.ShadersStore[i]||(e.ShadersStore[i]=r);const c=[t,n,a,l,f,d];for(const o of c)e.IncludesShadersStore[o.name]||(e.IncludesShadersStore[o.name]=o.shader);const V={name:i,shader:r};export{V as skyVertexShader};
