import{b6 as e}from"./index-1uQtRKdo.js";import{logDepthDeclaration as t}from"./logDepthDeclaration-YEU0Qk2u.js";import{clipPlaneVertexDeclaration as n}from"./clipPlaneVertexDeclaration-D-pInmiG.js";import{f as a,a as d}from"./fogVertex-Ujc3K42C.js";import{clipPlaneVertex as l}from"./clipPlaneVertex-oY6t_4Ee.js";import{l as f}from"./logDepthVertex-C7QQlenw.js";const i="skyVertexShader",r=`precision highp float;attribute vec3 position;
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
