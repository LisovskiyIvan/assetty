import{b6 as e}from"./index-CgKvOhs2.js";import{b as t,a as n,c as a,d}from"./bakedVertexAnimation-C_gC7JEJ.js";import{i as f}from"./instancesDeclaration-adm0EGkz.js";import{clipPlaneVertexDeclaration as s}from"./clipPlaneVertexDeclaration-B8KGa37N.js";import{logDepthDeclaration as c}from"./logDepthDeclaration-bRLsqemr.js";import{f as l,a as v}from"./fogVertex-BGq6k7Aa.js";import{i as m}from"./instancesVertex-CJGjxMOm.js";import{clipPlaneVertex as u}from"./clipPlaneVertex-CfpfRe5i.js";import{l as D}from"./logDepthVertex-C2JVFvUM.js";import{v as p}from"./vertexColorMixing-BNhK-6pW.js";const o="fireVertexShader",r=`precision highp float;attribute vec3 position;
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
varying vec2 vDiffuseUV;
#endif
#ifdef POINTSIZE
uniform float pointSize;
#endif
varying vec3 vPositionW;
#ifdef VERTEXCOLOR
varying vec4 vColor;
#endif
#include<clipPlaneVertexDeclaration>
#include<logDepthDeclaration>
#include<fogVertexDeclaration>
uniform float time;uniform float speed;
#ifdef DIFFUSE
varying vec2 vDistortionCoords1;varying vec2 vDistortionCoords2;varying vec2 vDistortionCoords3;
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
#ifdef DIFFUSE
vDiffuseUV=uv;vDiffuseUV.y-=0.2;
#endif
#include<clipPlaneVertex>
#include<logDepthVertex>
#include<fogVertex>
#include<vertexColorMixing>
#if defined(POINTSIZE) && !defined(WEBGPU)
gl_PointSize=pointSize;
#endif
#ifdef DIFFUSE
vec3 layerSpeed=vec3(-0.2,-0.52,-0.1)*speed;vDistortionCoords1.x=uv.x;vDistortionCoords1.y=uv.y+layerSpeed.x*time/1000.0;vDistortionCoords2.x=uv.x;vDistortionCoords2.y=uv.y+layerSpeed.y*time/1000.0;vDistortionCoords3.x=uv.x;vDistortionCoords3.y=uv.y+layerSpeed.z*time/1000.0;
#endif
#define CUSTOM_VERTEX_MAIN_END
}
`;e.ShadersStore[o]||(e.ShadersStore[o]=r);const x=[t,n,f,s,c,l,m,a,d,u,D,v,p];for(const i of x)e.IncludesShadersStore[i.name]||(e.IncludesShadersStore[i.name]=i.shader);const U={name:o,shader:r};export{U as fireVertexShader};
